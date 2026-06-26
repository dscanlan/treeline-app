#!/usr/bin/env node
// Stage both macOS ripgrep binaries (arm64 + x64) for the universal build.
//
// `@vscode/ripgrep` only installs the *host* arch's per-platform optional-dep
// package, but `package:mac` builds a universal2 app that must run rg on both
// Apple Silicon and Intel. We copy the installed host binary and `npm pack` the
// other arch's package (npm pack ignores the package's cpu/os fields, so it
// downloads cleanly on either host), landing both at:
//
//     resources/rg/<arch>/rg
//
// which electron-builder ships into the app via `extraResources` (see
// electron-builder.yml). At runtime, src/main/rg-path.ts picks by process.arch.
//
// Run automatically by `npm run package:mac`. Safe to re-run (idempotent).

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ARCHES = ['arm64', 'x64'];

/** Version to pin both arch packages to — read from the resolved wrapper. */
function ripgrepVersion() {
  // The host arch's package is installed; mirror its version for the other.
  for (const arch of ARCHES) {
    try {
      return require(`@vscode/ripgrep-darwin-${arch}/package.json`).version;
    } catch {
      /* not installed for this arch — try the next */
    }
  }
  // Fall back to the wrapper's declared optional-dep version.
  const pkg = require('@vscode/ripgrep/package.json');
  const dep = pkg.optionalDependencies?.['@vscode/ripgrep-darwin-arm64'];
  if (!dep) throw new Error('cannot determine @vscode/ripgrep version');
  return dep;
}

/** Resolve the rg binary for `arch`, downloading via npm pack if not installed. */
function stageArch(arch, version) {
  const destDir = join(root, 'resources', 'rg', arch);
  const dest = join(destDir, 'rg');
  mkdirSync(destDir, { recursive: true });

  // 1) Already installed in node_modules (the host arch)?
  let source;
  try {
    source = require.resolve(`@vscode/ripgrep-darwin-${arch}/bin/rg`);
  } catch {
    source = null;
  }

  // 2) Otherwise npm pack the tarball (ignores cpu/os) and extract bin/rg.
  let tmp;
  if (!source) {
    tmp = mkdtempSync(join(tmpdir(), 'rg-pack-'));
    const spec = `@vscode/ripgrep-darwin-${arch}@${version}`;
    console.log(`  fetching ${spec} …`);
    execFileSync('npm', ['pack', spec, '--pack-destination', tmp], { stdio: 'inherit' });
    const tgz = readdirSync(tmp).find((f) => f.endsWith('.tgz'));
    if (!tgz) throw new Error(`npm pack produced no tarball for ${spec}`);
    execFileSync('tar', ['-xzf', join(tmp, tgz), '-C', tmp], { stdio: 'inherit' });
    source = join(tmp, 'package', 'bin', 'rg');
  }

  if (!existsSync(source)) throw new Error(`rg binary missing for ${arch}: ${source}`);
  copyFileSync(source, dest);
  chmodSync(dest, 0o755);
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  console.log(`  staged ${arch} → ${dest}`);
}

const version = ripgrepVersion();
console.log(`Staging ripgrep ${version} for: ${ARCHES.join(', ')}`);
for (const arch of ARCHES) stageArch(arch, version);
console.log('ripgrep binaries staged.');
