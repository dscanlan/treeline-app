import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  changedFiles,
  createWorktree,
  fileDiff,
  initRepo,
  isDirty,
  isGitRepo,
  listWorktreesIn,
  parseUnifiedDiff,
  removeWorktree,
  repoRootAt,
  resolveParentRepoPath,
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

  // ── merged-state detection ────────────────────────────────────────────────
  // A worktree whose branch is already merged into the default branch is dead
  // weight; listWorktreesIn flags it (merged: true) so the sidebar greys it
  // out. The pair is a two-sided control: the first fails if detection never
  // fires, the second fails if it fires indiscriminately.

  it('flags a worktree whose branch is merged into the default branch', async () => {
    const opts = { cwd: repo, encoding: 'utf8' as const, env: ISOLATED_ENV };
    const wt = join(repo, 'feat-merged');
    addWorktreeRaw(repo, wt, 'feat-merged');
    // Commit on the branch, then merge it back into main so the branch tip is
    // an ancestor of main.
    const wtOpts = { cwd: wt, encoding: 'utf8' as const, env: ISOLATED_ENV };
    writeFileSync(join(wt, 'merged.txt'), 'done');
    execFileSync('git', ['add', '.'], wtOpts);
    execFileSync('git', ['commit', '-q', '--no-gpg-sign', '-m', 'feature work'], wtOpts);
    execFileSync('git', ['merge', '--no-ff', '--no-edit', 'feat-merged'], opts);

    const wts = await listWorktreesIn(repo);
    expect(wts.find((w) => w.branch === 'feat-merged')?.merged).toBe(true);
    // The default branch itself is never marked merged.
    expect(wts.find((w) => w.branch === 'main')?.merged).toBe(false);
  });

  it('does not flag a worktree with un-merged commits', async () => {
    const wt = join(repo, 'feat-active');
    addWorktreeRaw(repo, wt, 'feat-active');
    const wtOpts = { cwd: wt, encoding: 'utf8' as const, env: ISOLATED_ENV };
    writeFileSync(join(wt, 'wip.txt'), 'wip');
    execFileSync('git', ['add', '.'], wtOpts);
    execFileSync('git', ['commit', '-q', '--no-gpg-sign', '-m', 'wip'], wtOpts);

    const wts = await listWorktreesIn(repo);
    expect(wts.find((w) => w.branch === 'feat-active')?.merged).toBe(false);
  });

  it('does not flag a fresh branch sitting at the default branch tip', async () => {
    // A branch created off main with no commits of its own has a tip that is
    // (trivially) an ancestor of main, but nothing has been merged — it's
    // unstarted, not dead. Greying it out is the regression we guard against.
    const wt = join(repo, 'feat-fresh');
    addWorktreeRaw(repo, wt, 'feat-fresh');

    const wts = await listWorktreesIn(repo);
    expect(wts.find((w) => w.branch === 'feat-fresh')?.merged).toBe(false);
  });

  it('flags a fast-forward-merged branch sitting at the default branch tip', async () => {
    // When a branch's own commit is fast-forward-merged into main, main's tip
    // *becomes* the branch tip — they're the exact same commit, identical to a
    // fresh branch by ref state. But this one did real work that landed, so it
    // must still be flagged. (Two-sided control with the fresh-branch case
    // above, which sits at the same SHA but has no commits of its own.)
    const opts = { cwd: repo, encoding: 'utf8' as const, env: ISOLATED_ENV };
    const wt = join(repo, 'feat-ff');
    addWorktreeRaw(repo, wt, 'feat-ff');
    const wtOpts = { cwd: wt, encoding: 'utf8' as const, env: ISOLATED_ENV };
    writeFileSync(join(wt, 'ff.txt'), 'done');
    execFileSync('git', ['add', '.'], wtOpts);
    execFileSync('git', ['commit', '-q', '--no-gpg-sign', '-m', 'ff work'], wtOpts);
    // Fast-forward (default) merge: main advances to feat-ff's tip, so the two
    // branches share one SHA.
    execFileSync('git', ['merge', '--ff-only', '--no-edit', 'feat-ff'], opts);

    const wts = await listWorktreesIn(repo);
    const ff = wts.find((w) => w.branch === 'feat-ff');
    expect(ff?.commit).toBe(wts.find((w) => w.branch === 'main')?.commit); // same SHA
    expect(ff?.merged).toBe(true);
  });

  // ── resolveParentRepoPath ─────────────────────────────────────────────────
  // Drives the "Add repo or worktree" flow: any path inside a repo (root,
  // subdir, worktree) must resolve to the parent working tree so the user
  // can pick whatever's most convenient and treeline does the right thing.

  it('resolveParentRepoPath returns the repo root when given the repo root', async () => {
    const resolved = await resolveParentRepoPath(repo);
    expect(resolved).toBeTruthy();
    // tmpdir symlink hop: compare basename rather than the full path.
    expect(resolved!.split('/').pop()).toBe(repo.split('/').pop());
  });

  it('resolveParentRepoPath returns the repo root when given a subdirectory', async () => {
    const sub = join(repo, 'sub', 'dir');
    mkdirSync(sub, { recursive: true });
    const resolved = await resolveParentRepoPath(sub);
    expect(resolved!.split('/').pop()).toBe(repo.split('/').pop());
  });

  it('resolveParentRepoPath returns the parent repo when given a worktree path', async () => {
    const wt = join(repo, '.claude', 'worktrees', 'feat');
    mkdirSync(join(repo, '.claude', 'worktrees'), { recursive: true });
    addWorktreeRaw(repo, wt, 'feat');

    const resolved = await resolveParentRepoPath(wt);
    expect(resolved).toBeTruthy();
    // The parent's basename matches the original repo dir, NOT 'feat'.
    expect(resolved!.split('/').pop()).toBe(repo.split('/').pop());
    // And specifically does not end at the worktree path.
    expect(resolved!.endsWith('/feat')).toBe(false);
  });

  it('resolveParentRepoPath returns the parent repo from inside a worktree subdirectory', async () => {
    const wt = join(repo, '.claude', 'worktrees', 'feat');
    mkdirSync(join(repo, '.claude', 'worktrees'), { recursive: true });
    addWorktreeRaw(repo, wt, 'feat');
    const wtSub = join(wt, 'src');
    mkdirSync(wtSub, { recursive: true });

    const resolved = await resolveParentRepoPath(wtSub);
    expect(resolved!.split('/').pop()).toBe(repo.split('/').pop());
  });

  it('resolveParentRepoPath returns null for a non-git directory', async () => {
    const nonRepo = mkdtempSync(join(tmpdir(), 'treeline-not-repo-'));
    try {
      const resolved = await resolveParentRepoPath(nonRepo);
      expect(resolved).toBeNull();
    } finally {
      rmSync(nonRepo, { recursive: true, force: true });
    }
  });

  // ── initRepo ──────────────────────────────────────────────────────────────
  // Backs the "Create new repo" flow. `git init -b` lets us set the initial
  // branch in one shot regardless of the user's `init.defaultBranch` config.

  it('initRepo creates a git repo at the given path on the requested branch', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'treeline-init-'));
    try {
      await initRepo(empty, 'main');
      expect(await isGitRepo(empty)).toBe(true);
      const head = execFileSync('git', ['symbolic-ref', 'HEAD'], {
        cwd: empty,
        encoding: 'utf8',
        env: ISOLATED_ENV,
      }).trim();
      expect(head).toBe('refs/heads/main');
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('initRepo respects a custom initial branch name', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'treeline-init-'));
    try {
      await initRepo(empty, 'trunk');
      const head = execFileSync('git', ['symbolic-ref', 'HEAD'], {
        cwd: empty,
        encoding: 'utf8',
        env: ISOLATED_ENV,
      }).trim();
      expect(head).toBe('refs/heads/trunk');
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe('changedFiles', () => {
  let repo: string;
  let opts: { cwd: string; encoding: 'utf8'; env: typeof ISOLATED_ENV };

  beforeEach(() => {
    repo = setupRepo();
    opts = { cwd: repo, encoding: 'utf8', env: ISOLATED_ENV };
  });

  afterEach(() => {
    if (existsSync(repo)) rmSync(repo, { recursive: true, force: true });
  });

  it('returns [] on a clean worktree', async () => {
    expect(await changedFiles(repo)).toEqual([]);
  });

  it('categorizes modified, untracked, added, and deleted entries', async () => {
    // Commit a second file so we have something to delete.
    writeFileSync(join(repo, 'todelete.txt'), 'x');
    execFileSync('git', ['add', 'todelete.txt'], opts);
    execFileSync('git', ['commit', '-q', '--no-gpg-sign', '-m', 'add todelete'], opts);

    writeFileSync(join(repo, 'file.txt'), 'changed'); // tracked, unstaged → modified
    writeFileSync(join(repo, 'untracked.txt'), 'new'); // untracked
    writeFileSync(join(repo, 'added.txt'), 'add'); // staged add
    execFileSync('git', ['add', 'added.txt'], opts);
    rmSync(join(repo, 'todelete.txt')); // unstaged delete

    const changes = await changedFiles(repo);
    const byRel = new Map(changes.map((c) => [c.relPath, c.status]));
    expect(byRel.get('file.txt')).toBe('modified');
    expect(byRel.get('untracked.txt')).toBe('untracked');
    expect(byRel.get('added.txt')).toBe('added');
    expect(byRel.get('todelete.txt')).toBe('deleted');
  });

  it('enumerates the files inside an untracked directory (no collapsed `dir/` row)', async () => {
    // Plain `git status --porcelain` collapses a brand-new folder into one
    // `?? newdir/` row, which points at a directory the panel can't open.
    // `-uall` lists each contained file instead, so every row is openable.
    mkdirSync(join(repo, 'newdir'));
    writeFileSync(join(repo, 'newdir', 'a.txt'), '1');
    writeFileSync(join(repo, 'newdir', 'b.txt'), '2');

    const changes = await changedFiles(repo);
    expect(changes.find((c) => c.relPath === 'newdir/')).toBeUndefined();
    const a = changes.find((c) => c.relPath === 'newdir/a.txt');
    const b = changes.find((c) => c.relPath === 'newdir/b.txt');
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(a!.isDir).toBe(false);
    expect(a!.status).toBe('untracked');
    expect(b!.status).toBe('untracked');
  });

  it('does not flag regular files as directories', async () => {
    writeFileSync(join(repo, 'file.txt'), 'changed');
    const changes = await changedFiles(repo);
    expect(changes.find((c) => c.relPath === 'file.txt')!.isDir).toBe(false);
  });

  it('returns worktree-rooted absolute paths, sorted by relative path', async () => {
    writeFileSync(join(repo, 'z.txt'), '1');
    writeFileSync(join(repo, 'a.txt'), '2');

    const changes = await changedFiles(repo);
    expect(changes.map((c) => c.relPath)).toEqual(['a.txt', 'z.txt']);
    expect(changes[0]!.path).toBe(join(repo, 'a.txt'));
  });
});

describe('parseUnifiedDiff', () => {
  it('tracks line numbers and add/remove counts across a hunk', () => {
    const raw = [
      'diff --git a/f.txt b/f.txt',
      'index abc..def 100644',
      '--- a/f.txt',
      '+++ b/f.txt',
      '@@ -1,3 +1,3 @@ heading',
      ' line1',
      '-line2old',
      '+line2new',
      ' line3',
      '',
    ].join('\n');

    const diff = parseUnifiedDiff('/f.txt', raw);
    expect(diff.added).toBe(1);
    expect(diff.removed).toBe(1);
    expect(diff.binary).toBe(false);
    expect(diff.lines).toEqual([
      { kind: 'hunk', oldLine: null, newLine: null, text: 'heading' },
      { kind: 'context', oldLine: 1, newLine: 1, text: 'line1' },
      { kind: 'del', oldLine: 2, newLine: null, text: 'line2old' },
      { kind: 'add', oldLine: null, newLine: 2, text: 'line2new' },
      { kind: 'context', oldLine: 3, newLine: 3, text: 'line3' },
    ]);
  });

  it('flags a binary diff', () => {
    const diff = parseUnifiedDiff('/img.png', 'Binary files a/img.png and b/img.png differ\n');
    expect(diff.binary).toBe(true);
    expect(diff.lines).toEqual([]);
  });
});

describe('fileDiff', () => {
  let repo: string;

  beforeEach(() => {
    repo = setupRepo();
  });

  afterEach(() => {
    if (existsSync(repo)) rmSync(repo, { recursive: true, force: true });
  });

  it('diffs a modified tracked file vs HEAD', async () => {
    writeFileSync(join(repo, 'file.txt'), 'hello world'); // was "hello"
    const diff = await fileDiff(join(repo, 'file.txt'));
    expect(diff.added).toBe(1);
    expect(diff.removed).toBe(1);
    expect(diff.lines.some((l) => l.kind === 'add' && l.text === 'hello world')).toBe(true);
    expect(diff.lines.some((l) => l.kind === 'del' && l.text === 'hello')).toBe(true);
  });

  it('renders an untracked file as all additions', async () => {
    writeFileSync(join(repo, 'new.txt'), 'a\nb\nc\n');
    const diff = await fileDiff(join(repo, 'new.txt'));
    expect(diff.removed).toBe(0);
    expect(diff.added).toBe(3);
    expect(diff.lines.map((l) => l.kind)).toEqual(['add', 'add', 'add']);
    expect(diff.lines.map((l) => l.newLine)).toEqual([1, 2, 3]);
  });
});
