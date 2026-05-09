// Pure parser for `git worktree list --porcelain`. No filesystem access — that
// belongs in git.ts. Ported from the line-state-machine in
// /Users/dominicscanlan/code/treeline/src/git.rs:112-145.

export interface PorcelainWorktree {
  /** Absolute path as reported by git (no resolution applied). */
  path: string;
  /** Branch name with `refs/heads/` stripped, or `(bare)` / `(detached)` / `''`. */
  branch: string;
  /** Up-to-7-char short SHA. */
  commit: string;
  isBare: boolean;
}

/** Parse the full porcelain output into one record per worktree. */
export function parseWorktreePorcelain(text: string): PorcelainWorktree[] {
  const out: PorcelainWorktree[] = [];

  let path: string | null = null;
  let branch = '';
  let commit = '';
  let isBare = false;

  const flush = () => {
    if (path !== null) {
      out.push({ path, branch, commit, isBare });
    }
    path = null;
    branch = '';
    commit = '';
    isBare = false;
  };

  // text.split('\n') handles both `\n` and trailing-newline-or-not. We don't
  // accept `\r\n` because `git` emits LF on macOS.
  for (const line of text.split('\n')) {
    if (line.startsWith('worktree ')) {
      // A new record begins. If the previous record never saw a blank line
      // (last entry, no trailing newline), flush it now.
      if (path !== null) flush();
      path = line.slice('worktree '.length);
    } else if (line.startsWith('HEAD ')) {
      const c = line.slice('HEAD '.length);
      commit = c.slice(0, Math.min(7, c.length));
    } else if (line.startsWith('branch ')) {
      const b = line.slice('branch '.length);
      branch = b.startsWith('refs/heads/') ? b.slice('refs/heads/'.length) : b;
    } else if (line === 'bare') {
      isBare = true;
      branch = '(bare)';
    } else if (line === 'detached') {
      branch = '(detached)';
    } else if (line === '') {
      flush();
    }
    // Any other lines (`locked`, `prunable`, future fields) are ignored.
  }

  // Final entry without a trailing blank line.
  if (path !== null) flush();

  return out;
}
