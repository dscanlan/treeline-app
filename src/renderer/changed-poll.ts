// Polling loop for the open Changed view, extracted from the component so it
// can be unit-tested without a DOM. The worktree-set watcher only emits on
// coarse transitions (notably the first clean→dirty flip), so an already-dirty
// worktree needs this poll to pick up further working-tree changes made outside
// the app (e.g. in a terminal).

/** Default cadence for re-fetching `git status` while the Changed view is open. */
export const CHANGED_POLL_MS = 2500;

export interface ChangedPollDeps {
  /** Re-fetch a worktree's changed files (return value ignored). */
  refresh: (worktreePath: string) => unknown;
  /** Whether the window is visible — ticks are skipped while it isn't. */
  isVisible: () => boolean;
  /** Override the interval (tests). Defaults to {@link CHANGED_POLL_MS}. */
  intervalMs?: number;
}

/**
 * Start polling `refresh(worktreePath)`: once immediately, then every
 * `intervalMs`, skipping ticks while the window is hidden. Returns a stop
 * function suitable for a `useEffect` cleanup.
 */
export function startChangedFilesPoll(worktreePath: string, deps: ChangedPollDeps): () => void {
  const { refresh, isVisible, intervalMs = CHANGED_POLL_MS } = deps;
  // Refresh once on start: covers re-mounting a row whose view was already
  // 'changed', where no view-switch refresh fires.
  refresh(worktreePath);
  const id = setInterval(() => {
    if (isVisible()) refresh(worktreePath);
  }, intervalMs);
  return () => clearInterval(id);
}
