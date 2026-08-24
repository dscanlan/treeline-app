/**
 * Turns `WorktreeWatcher`'s "here is the current worktree set for this repo"
 * signal into "these paths are genuinely new" — the trigger behind the
 * "open/continue in the new worktree?" prompt.
 *
 * The watcher emits on *any* change to a repo's worktree records (a dirty flag
 * flipping, a branch moving, a worktree appearing or vanishing), so creation
 * has to be recovered by diffing consecutive snapshots. Two guards keep that
 * diff from inventing creations:
 *
 *  - The first snapshot for a repo seeds silently, so neither app launch nor
 *    adding a repo prompts for worktrees that already existed.
 *  - A snapshot that adds more than `burstMax` paths at once is treated as a
 *    snapshot *recovering* rather than as N worktrees the user just made, and
 *    re-seeds silently. `git worktree add` adds one path; a jump from 0 to 47
 *    is a previous snapshot having been short (a listing that failed or ran
 *    while the worktrees were unreadable), and firing a prompt per path buries
 *    the user in toasts for worktrees they've had for weeks.
 */
export class NewWorktreeTracker {
  /** repoPath → worktree paths as of the last snapshot we accepted. */
  private readonly seenByRepo = new Map<string, Set<string>>();

  constructor(private readonly burstMax = 2) {}

  /**
   * Record a repo's current worktree paths and return the ones worth
   * announcing as newly created (empty on the seeding snapshot, on no change,
   * and on a suspicious burst).
   */
  observe(repoPath: string, paths: string[]): string[] {
    const seen = this.seenByRepo.get(repoPath);
    this.seenByRepo.set(repoPath, new Set(paths));
    if (!seen) return [];
    const added = paths.filter((p) => !seen.has(p));
    return added.length > this.burstMax ? [] : added;
  }
}
