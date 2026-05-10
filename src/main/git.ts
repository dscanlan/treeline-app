import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Worktree } from '@shared/types';
import { detectClaudeWorktree } from '@shared/claude-detect';
import { parseWorktreePorcelain } from './git-porcelain';
import { ProcessError, run } from './util/exec';

const GIT = 'git';

/** True if the given path is the root (or under) a git working tree. */
export async function isGitRepo(path: string): Promise<boolean> {
  try {
    const { stdout } = await run(GIT, ['rev-parse', '--show-toplevel'], {
      cwd: path,
      throwOnError: false,
    });
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

/** Returns the toplevel of the repo containing `path`, or null if not in a repo. */
export async function repoRootAt(path: string): Promise<string | null> {
  const { stdout } = await run(GIT, ['rev-parse', '--show-toplevel'], {
    cwd: path,
    throwOnError: false,
  });
  const trimmed = stdout.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Resolves any path inside a git repo to the **parent** working tree —
 * `cgs/.claude/worktrees/foo` → `cgs`, `cgs/src/util` → `cgs`, `cgs` → `cgs`.
 *
 * Implemented via `git rev-parse --git-common-dir`, which always points at the
 * shared `.git` directory regardless of whether `path` is a main checkout, a
 * subdirectory, or a linked worktree. Returns null if `path` is not inside any
 * git repository. For bare repos, returns the `.git` directory itself (callers
 * may want to surface that as an error rather than tracking it; treeline's
 * worktree flow doesn't currently make sense for bare repos).
 */
export async function resolveParentRepoPath(path: string): Promise<string | null> {
  // `--path-format=absolute` is supported since git 2.31 (March 2021); macOS's
  // bundled git is newer than that. Without it, common-dir is sometimes printed
  // relative to cwd, which leads to wrong dirname() results.
  const { stdout } = await run(
    GIT,
    ['rev-parse', '--path-format=absolute', '--git-common-dir', '--is-bare-repository'],
    { cwd: path, throwOnError: false },
  );
  // Output is two lines: <abs path to common .git dir> then <true|false>.
  const lines = stdout.trim().split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return null;
  const commonDir = lines[0]!;
  const isBare = lines[1] === 'true';
  if (!commonDir) return null;
  return isBare ? commonDir : dirname(commonDir);
}

/** True if the worktree at `path` has any uncommitted or untracked changes. */
export async function isDirty(path: string): Promise<boolean> {
  const { stdout } = await run(GIT, ['status', '--porcelain'], {
    cwd: path,
    throwOnError: false,
  });
  return stdout.length > 0;
}

/**
 * List worktrees in the repo at `repoPath`. Stale entries (where the on-disk
 * path is gone) are filtered out, matching Treeline's `build_worktree`
 * behaviour at git.rs:148-170.
 */
export async function listWorktreesIn(repoPath: string): Promise<Worktree[]> {
  const { stdout } = await run(GIT, ['worktree', 'list', '--porcelain'], {
    cwd: repoPath,
  });

  const records = parseWorktreePorcelain(stdout);

  // Filter out stale entries (non-bare with no on-disk path) before the dirty
  // check so we don't waste a subprocess on each.
  const live = records.filter((r) => r.isBare || existsSync(r.path));

  // Run dirty checks in parallel.
  const dirtyResults = await Promise.all(
    live.map((r) => (r.isBare ? Promise.resolve(false) : isDirty(r.path))),
  );

  return live.map((r, i) => ({
    path: r.path,
    branch: r.branch,
    commit: r.commit,
    isBare: r.isBare,
    isDirty: dirtyResults[i] ?? false,
    isCurrent: false,
    isClaude: detectClaudeWorktree(r.path, r.branch),
  }));
}

/**
 * Create a worktree. If the branch already exists, retry without `-b`, matching
 * the Rust fallback at git.rs:207-229.
 */
export async function createWorktree(
  repoPath: string,
  path: string,
  branch: string,
): Promise<void> {
  try {
    await run(GIT, ['worktree', 'add', '-b', branch, path], { cwd: repoPath });
    return;
  } catch (err) {
    if (err instanceof ProcessError && err.stderr.includes('already exists')) {
      // Branch exists — reuse it on the new worktree path.
      await run(GIT, ['worktree', 'add', path, branch], { cwd: repoPath });
      return;
    }
    throw err;
  }
}

/** Force-remove a worktree. */
export async function removeWorktree(path: string): Promise<void> {
  // `git worktree remove` resolves the repo from the cwd, not from the argument.
  // Run from inside the worktree itself — it still exists on disk at this
  // point, and from there git can locate the parent gitdir.
  await run(GIT, ['worktree', 'remove', '--force', path], { cwd: path });
}

/**
 * Initialize a fresh git repo at `path` on the given branch. `git init -b` has
 * been supported since git 2.28 (Jul 2020) — macOS bundled git is newer.
 *
 * Caller is responsible for ensuring `path` exists and is NOT already a repo;
 * `git init` is idempotent so re-running on an existing repo would silently
 * succeed, which would be a surprising UX. The IPC layer (repos-create.ts)
 * enforces the not-already-a-repo precondition.
 */
export async function initRepo(path: string, branch: string): Promise<void> {
  await run(GIT, ['init', '-b', branch], { cwd: path });
}
