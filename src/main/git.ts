import { existsSync } from 'node:fs';
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
