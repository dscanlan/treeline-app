import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRepo } from '../src/main/repos-create';
import { ReposStore } from '../src/main/repos-store';
import { isGitRepo } from '../src/main/git';

// Mirror the git-test isolation: don't let the user's global gitconfig
// influence what `git init` produces inside repos-create.
const ISOLATED_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GNUPGHOME: '/dev/null',
};

describe('createRepo', () => {
  let root: string;
  let storePath: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'treeline-create-'));
    storePath = join(root, 'config.json');
  });

  afterEach(() => {
    if (existsSync(root)) {
      // Some tests chmod a parent to 0o555; restore before rm or rm fails.
      try {
        chmodSync(root, 0o755);
      } catch {
        /* ignore */
      }
      rmSync(root, { recursive: true, force: true });
    }
  });

  function newStore(): ReposStore {
    const s = new ReposStore(storePath);
    s.load();
    return s;
  }

  // ── new-folder ────────────────────────────────────────────────────────────

  it('new-folder happy path: creates the directory, initializes it, registers it', async () => {
    const store = newStore();
    const parent = join(root, 'parent');
    mkdirSync(parent);

    const repo = await createRepo(store, {
      mode: 'new-folder',
      basePath: parent,
      folderName: 'my-repo',
      branch: 'main',
    });

    const target = join(parent, 'my-repo');
    expect(repo.path).toBe(target);
    expect(existsSync(target)).toBe(true);
    expect(await isGitRepo(target)).toBe(true);
    expect(store.get().repos.map((r) => r.path)).toEqual([target]);
  });

  it('new-folder rejects when the parent does not exist', async () => {
    const store = newStore();
    await expect(
      createRepo(store, {
        mode: 'new-folder',
        basePath: join(root, 'nope'),
        folderName: 'x',
        branch: 'main',
      }),
    ).rejects.toThrow(/not a directory/i);
  });

  it('new-folder rejects when the parent is not writable', async () => {
    const store = newStore();
    const parent = join(root, 'ro');
    mkdirSync(parent);
    chmodSync(parent, 0o555);
    try {
      await expect(
        createRepo(store, {
          mode: 'new-folder',
          basePath: parent,
          folderName: 'x',
          branch: 'main',
        }),
      ).rejects.toThrow(/not writable/i);
    } finally {
      chmodSync(parent, 0o755);
    }
  });

  it('new-folder rejects when the target already exists', async () => {
    const store = newStore();
    const parent = join(root, 'parent');
    mkdirSync(parent);
    mkdirSync(join(parent, 'taken'));

    await expect(
      createRepo(store, {
        mode: 'new-folder',
        basePath: parent,
        folderName: 'taken',
        branch: 'main',
      }),
    ).rejects.toThrow(/already exists/i);
    // No repo registered.
    expect(store.get().repos).toEqual([]);
  });

  it('new-folder rejects a folder name containing path separators', async () => {
    const store = newStore();
    const parent = join(root, 'parent');
    mkdirSync(parent);

    await expect(
      createRepo(store, {
        mode: 'new-folder',
        basePath: parent,
        folderName: 'has/slash',
        branch: 'main',
      }),
    ).rejects.toThrow(/path separators/i);
  });

  // ── existing-folder ───────────────────────────────────────────────────────

  it('existing-folder happy path: initializes an empty directory', async () => {
    const store = newStore();
    const target = join(root, 'empty');
    mkdirSync(target);

    const repo = await createRepo(store, {
      mode: 'existing-folder',
      basePath: target,
      branch: 'main',
    });

    expect(repo.path).toBe(target);
    expect(await isGitRepo(target)).toBe(true);
  });

  it('existing-folder treats a lone .DS_Store as empty', async () => {
    const store = newStore();
    const target = join(root, 'ds-only');
    mkdirSync(target);
    writeFileSync(join(target, '.DS_Store'), '');

    const repo = await createRepo(store, {
      mode: 'existing-folder',
      basePath: target,
      branch: 'main',
    });
    expect(await isGitRepo(repo.path)).toBe(true);
  });

  it('existing-folder rejects a missing path', async () => {
    const store = newStore();
    await expect(
      createRepo(store, {
        mode: 'existing-folder',
        basePath: join(root, 'gone'),
        branch: 'main',
      }),
    ).rejects.toThrow(/does not exist/i);
  });

  it('existing-folder rejects when the target is a file', async () => {
    const store = newStore();
    const file = join(root, 'a-file');
    writeFileSync(file, 'hi');
    await expect(
      createRepo(store, {
        mode: 'existing-folder',
        basePath: file,
        branch: 'main',
      }),
    ).rejects.toThrow(/not a directory/i);
  });

  it('existing-folder rejects when the target is already a git repo', async () => {
    const store = newStore();
    const target = join(root, 'already');
    mkdirSync(target);
    execFileSync('git', ['init', '-q', '-b', 'main'], {
      cwd: target,
      env: ISOLATED_ENV,
    });
    const gitDirBefore = existsSync(join(target, '.git'));

    await expect(
      createRepo(store, {
        mode: 'existing-folder',
        basePath: target,
        branch: 'main',
      }),
    ).rejects.toThrow(/already a git repo/i);
    // The pre-existing .git is left intact.
    expect(existsSync(join(target, '.git'))).toBe(gitDirBefore);
    expect(store.get().repos).toEqual([]);
  });

  it('existing-folder rejects a non-empty directory', async () => {
    const store = newStore();
    const target = join(root, 'has-stuff');
    mkdirSync(target);
    writeFileSync(join(target, 'README.md'), '# hello');
    await expect(
      createRepo(store, {
        mode: 'existing-folder',
        basePath: target,
        branch: 'main',
      }),
    ).rejects.toThrow(/not empty/i);
  });

  // ── shape / validation ────────────────────────────────────────────────────

  it('rejects an unknown mode', async () => {
    const store = newStore();
    await expect(
      createRepo(store, {
        // intentionally bogus
        mode: 'whatever' as unknown as 'new-folder',
        basePath: root,
        branch: 'main',
      }),
    ).rejects.toThrow(/mode must be/i);
  });

  it('rejects a branch name starting with a dash', async () => {
    const store = newStore();
    const target = join(root, 'ok');
    mkdirSync(target);
    await expect(
      createRepo(store, {
        mode: 'existing-folder',
        basePath: target,
        branch: '-bad',
      }),
    ).rejects.toThrow(/branch must not start with/i);
  });
});
