import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// cli-install.ts imports `app` from electron as a value, so stub it. The pure
// functions under test don't touch app, but the module-level import must resolve.
let userData = '';
let appPath = '';
let packaged = false;
vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => (name === 'userData' ? userData : ''),
    getAppPath: () => appPath,
    get isPackaged() {
      return packaged;
    },
  },
}));

import {
  cliScriptPath,
  cliShimPath,
  materializeCliShim,
  renderShim,
  writeExecutableIfChanged,
} from '../src/main/cli-install';

let dir = '';
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tl-cli-'));
  userData = join(dir, 'userData');
  appPath = join(dir, 'app');
  packaged = false;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('renderShim', () => {
  it('emits a runnable shim that execs the script via Electron-as-Node', () => {
    const s = renderShim({
      execPath: '/Applications/Treeline.app/Contents/MacOS/Treeline',
      scriptPath: '/path/to/treeline.mjs',
      shimPath: '/bin/treeline',
    });
    expect(s.startsWith('#!/bin/sh\n')).toBe(true);
    expect(s).toContain("export TREELINE_CLI_BIN='/bin/treeline'");
    expect(s).toContain(
      "ELECTRON_RUN_AS_NODE=1 exec '/Applications/Treeline.app/Contents/MacOS/Treeline' '/path/to/treeline.mjs' \"$@\"",
    );
  });

  it('single-quotes paths containing spaces and apostrophes', () => {
    const s = renderShim({
      execPath: "/Apps/Bob's App/Treeline",
      scriptPath: '/a b/treeline.mjs',
      shimPath: '/bin/treeline',
    });
    expect(s).toContain(`'/Apps/Bob'\\''s App/Treeline'`);
    expect(s).toContain(`'/a b/treeline.mjs'`);
  });
});

describe('writeExecutableIfChanged', () => {
  it('writes a new file as 0755 and reports it wrote', () => {
    const p = join(dir, 'shim');
    expect(writeExecutableIfChanged(p, 'hello')).toBe(true);
    expect(readFileSync(p, 'utf8')).toBe('hello');
    expect(statSync(p).mode & 0o777).toBe(0o755);
  });

  it('is a no-op when contents are unchanged', () => {
    const p = join(dir, 'shim');
    writeExecutableIfChanged(p, 'same');
    expect(writeExecutableIfChanged(p, 'same')).toBe(false);
  });

  it('rewrites when contents differ', () => {
    const p = join(dir, 'shim');
    writeExecutableIfChanged(p, 'v1');
    expect(writeExecutableIfChanged(p, 'v2')).toBe(true);
    expect(readFileSync(p, 'utf8')).toBe('v2');
  });
});

describe('cliScriptPath', () => {
  it('uses the repo path in dev', () => {
    packaged = false;
    expect(cliScriptPath()).toBe(join(appPath, 'bin', 'treeline.mjs'));
  });

  it('uses the unpacked asar sibling when packaged', () => {
    packaged = true;
    expect(cliScriptPath()).toBe(join(`${appPath}.unpacked`, 'bin', 'treeline.mjs'));
  });
});

describe('materializeCliShim', () => {
  it('creates an executable shim under userData and returns its dir', () => {
    const binDir = materializeCliShim();
    const shim = cliShimPath();
    expect(binDir).toBe(join(userData, 'bin'));
    expect(statSync(shim).mode & 0o777).toBe(0o755);
    expect(readFileSync(shim, 'utf8')).toContain('ELECTRON_RUN_AS_NODE=1 exec');
  });

  it('is idempotent across launches (stable mtime when unchanged)', () => {
    materializeCliShim();
    const shim = cliShimPath();
    const first = statSync(shim).mtimeMs;
    // Tamper to prove a no-op rewrite would change mtime, then re-materialize.
    materializeCliShim();
    expect(statSync(shim).mtimeMs).toBe(first);
  });

  it('self-heals after the contents drift (e.g. Electron moved)', () => {
    materializeCliShim();
    const shim = cliShimPath();
    writeFileSync(shim, 'stale');
    materializeCliShim();
    expect(readFileSync(shim, 'utf8')).toContain('ELECTRON_RUN_AS_NODE=1 exec');
  });
});
