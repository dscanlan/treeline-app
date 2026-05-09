// Mirrors the Claude-worktree detection rule from
// /Users/dominicscanlan/code/treeline/src/git.rs:19-22 — a worktree counts as
// "Claude" if its on-disk path lives under a `.claude/worktrees/` directory or
// if its branch name uses the `worktree-*` convention.

export function detectClaudeWorktree(absPath: string, branch: string): boolean {
  if (absPath.includes('/.claude/worktrees/')) return true;
  if (branch.startsWith('worktree-')) return true;
  return false;
}
