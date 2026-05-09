import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createWorktree,
  isDirty,
  isGitRepo,
  listWorktreesIn,
  removeWorktree,
  repoRootAt,
} from '../src/main/git';

// Mirrors setup_repo / add_worktree in /Users/dominicscanlan/code/treeline/src/git.rs:238-275.
// We isolate from the user's global gitconfig (commit signing, hooks, etc.) so
// the suite works on machines with 1Password / GPG / SSH-based commit signing.
const ISOLATED_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  // Defensive: ensure no signing keys are inherited.
  GNUPGHOME: '/dev/null',
};

function setupRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'treeline-test-'));
  const opts = { cwd: dir, encoding: 'utf8' as const, env: ISOLATED_ENV };
  execFileSync('git', ['init', '-q', '-b', 'main'], opts);
  execFileSync('git', ['config', 'user.email', 'test@test.com'], opts);
  execFileSync('git', ['config', 'user.name', 'Test'], opts);
  execFileSync('git', ['config', 'commit.gpgsign', 'false'], opts);
  execFileSync('git', ['config', 'tag.gpgsign', 'false'], opts);
  writeFileSync(join(dir, 'file.txt'), 'hello');
  execFileSync('git', ['add', '.'], opts);
  execFileSync('git', ['commit', '-q', '--no-gpg-sign', '-m', 'initial'], opts);
  return dir;
}

function addWorktreeRaw(repo: string, wtPath: string, branch: string): void {
  execFileSync('git', ['worktree', 'add', '-b', branch, wtPath], {
    cwd: repo,
    encoding: 'utf8',
    env: ISOLATED_ENV,
  });
}

describe('git module', () => {
  let repo: string;

  beforeEach(() => {
    repo = setupRepo();
  });

  afterEach(() => {
    if (existsSync(repo)) rmSync(repo, { recursive: true, force: true });
  });

  it('isGitRepo returns true for a real repo and false for a non-repo', async () => {
    expect(await isGitRepo(repo)).toBe(true);
    const nonRepo = mkdtempSync(join(tmpdir(), 'treeline-not-repo-'));
    try {
      expect(await isGitRepo(nonRepo)).toBe(false);
    } finally {
      rmSync(nonRepo, { recursive: true, force: true });
    }
  });

  it('repoRootAt returns the toplevel for a repo path', async () => {
    const root = await repoRootAt(repo);
    expect(root).toBeTruthy();
    // Different macOS tmpdirs may resolve through /private/var ↔ /var.
    expect(root!.endsWith(repo.split('/').pop()!)).toBe(true);
  });

  it('listWorktreesIn returns the main worktree on a fresh repo', async () => {
    const wts = await listWorktreesIn(repo);
    expect(wts).toHaveLength(1);
    expect(wts[0]?.isBare).toBe(false);
    expect(wts[0]?.isDirty).toBe(false);
    expect(wts[0]?.branch).toBe('main');
  });

  it('lists newly-added worktrees and detects dirty status', async () => {
    const wt = join(repo, 'feat-x');
    addWorktreeRaw(repo, wt, 'feat-x');
    writeFileSync(join(wt, 'untracked.txt'), 'dirty');

    const wts = await listWorktreesIn(repo);
    expect(wts).toHaveLength(2);
    const feat = wts.find((w) => w.branch === 'feat-x');
    expect(feat).toBeTruthy();
    expect(feat!.isDirty).toBe(true);
  });

  it('createWorktree → list → remove round-trip works', async () => {
    const wt = join(repo, 'roundtrip');
    await createWorktree(repo, wt, 'roundtrip');
    let wts = await listWorktreesIn(repo);
    expect(wts.find((w) => w.branch === 'roundtrip')).toBeTruthy();

    await removeWorktree(wt);
    wts = await listWorktreesIn(repo);
    expect(wts.find((w) => w.branch === 'roundtrip')).toBeUndefined();
  });

  it('createWorktree reuses an existing branch after the worktree dir is removed (Rust git.rs:341-357)', async () => {
    const wt = join(repo, 'recreate');
    await createWorktree(repo, wt, 'recreate');
    await removeWorktree(wt);

    // Branch still exists; second create with `-b` should fail and trigger the
    // fallback in createWorktree.
    await createWorktree(repo, wt, 'recreate');

    const wts = await listWorktreesIn(repo);
    expect(wts.find((w) => w.branch === 'recreate')).toBeTruthy();
  });

  it('isDirty is false on a clean worktree and true after writing untracked content', async () => {
    expect(await isDirty(repo)).toBe(false);
    writeFileSync(join(repo, 'untracked.txt'), 'x');
    expect(await isDirty(repo)).toBe(true);
  });

  it('claude detection sets isClaude for branches starting with `worktree-`', async () => {
    const wt = join(repo, 'wt-x');
    addWorktreeRaw(repo, wt, 'worktree-abc');
    const wts = await listWorktreesIn(repo);
    const claude = wts.find((w) => w.branch === 'worktree-abc');
    expect(claude?.isClaude).toBe(true);
  });

  it('claude detection sets isClaude for paths under .claude/worktrees/', async () => {
    const claudeWt = join(repo, '.claude', 'worktrees', 'feat');
    mkdirSync(join(repo, '.claude', 'worktrees'), { recursive: true });
    addWorktreeRaw(repo, claudeWt, 'regular-branch');
    const wts = await listWorktreesIn(repo);
    // macOS tmpdirs symlink /var ↔ /private/var, so paths from git may not
    // string-match what we computed. Find by branch instead.
    const claude = wts.find((w) => w.branch === 'regular-branch');
    expect(claude?.isClaude).toBe(true);
    expect(claude?.path.includes('/.claude/worktrees/')).toBe(true);
  });
});
