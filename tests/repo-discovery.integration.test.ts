import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RepoDiscovery, type DiscoveredRepoEvent } from '../src/main/repo-discovery';

// Integration test: exercises the *real* default resolver (real `git`), not a
// fixture map. Proves the production discovery path classifies an out-of-tree
// worktree of a tracked repo as `tracked` — the bug the toast fix addresses.
const ISOLATED_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GNUPGHOME: '/dev/null',
};

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, encoding: 'utf8', env: ISOLATED_ENV });
}

function makeRepo(parent: string, name: string): string {
  const dir = join(parent, name);
  execFileSync('mkdir', ['-p', dir]);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'test@test.com');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(dir, 'file.txt'), 'hello');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '--no-gpg-sign', '-m', 'initial');
  return realpathSync(dir);
}

describe('RepoDiscovery (real git, default resolver)', () => {
  let root: string;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'treeline-disc-')));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('does NOT surface an out-of-tree worktree of a tracked repo', async () => {
    const repo = makeRepo(root, 'myrepo');
    // Worktree lives OUTSIDE the repo root (sibling dir) — fails the cheap
    // prefix check and falls through to the resolver. This is the bug case.
    const externalWt = join(root, 'myrepo-external-wt');
    git(repo, 'worktree', 'add', '-q', '-b', 'feat/external', externalWt);

    const d = new RepoDiscovery(); // real defaultResolver → resolveParentRepoPath
    d.setTrackedRepos([repo]);
    const events: DiscoveredRepoEvent[] = [];
    d.on('discovered-repo', (e) => events.push(e as DiscoveredRepoEvent));

    await d.onCwd(realpathSync(externalWt));

    // Pre-fix this emitted `discovered-repo` (--show-toplevel returned the
    // worktree's own dir); post-fix it resolves to the tracked parent repo.
    expect(events).toEqual([]);
  });

  it('still surfaces a genuinely untracked repo', async () => {
    const untracked = makeRepo(root, 'untracked');

    const d = new RepoDiscovery();
    d.setTrackedRepos([makeRepo(root, 'tracked')]);
    const events: DiscoveredRepoEvent[] = [];
    d.on('discovered-repo', (e) => events.push(e as DiscoveredRepoEvent));

    await d.onCwd(untracked);

    expect(events).toEqual([{ repoPath: untracked, viaCwd: untracked }]);
  });
});
