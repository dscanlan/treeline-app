import type { StateCreator } from 'zustand';
import type { TabsSlice } from './tabs-slice';

/** Why we're offering to open a terminal in a worktree. */
export type DriftReason =
  // A terminal's cwd moved into this worktree (manual `cd` in the shell).
  | 'drift'
  // A new worktree was just created (e.g. `git worktree add` by an agent).
  | 'created';

export interface WorktreeOpen {
  /** Worktree to open/focus a terminal in — also the map key. */
  toWorktree: string;
  reason: DriftReason;
  /**
   * The drifted PTY, present only for `reason: 'drift'`. Drives the per-tab
   * chip (a created-worktree suggestion has no originating tab).
   */
  ptyId?: string;
}

export interface DriftSlice {
  /**
   * In-memory suggestions to open a terminal in a worktree, keyed by worktree
   * path so the two triggers (cwd drift, worktree creation) dedupe against each
   * other. Not persisted — this is live session state.
   */
  driftByWorktree: Record<string, WorktreeOpen>;

  /**
   * Record a suggestion. No-op if a terminal tab already exists at the target
   * worktree (the user already has a terminal there — nothing to offer), or if
   * an equivalent suggestion is already queued.
   */
  enqueueWorktreeOpen: (d: WorktreeOpen) => void;
  /** Drop the suggestion for a worktree (acted on, or its tab/pane closed). */
  dismissWorktreeOpen: (toWorktree: string) => void;
  /** Drop any drift suggestion owned by a PTY (its tab/pane closed). */
  dismissDriftByPty: (ptyId: string) => void;
}

export const createDriftSlice: StateCreator<
  DriftSlice & TabsSlice,
  [],
  [],
  DriftSlice
> = (set, get) => ({
  driftByWorktree: {},

  enqueueWorktreeOpen: (d) =>
    set((s) => {
      // Suppress if there's already a tab for that worktree — `openTabAt` would
      // just focus it, so there's nothing worth prompting about.
      if (get().tabsByCwd[d.toWorktree]?.length) return s;
      const existing = s.driftByWorktree[d.toWorktree];
      if (existing && existing.reason === d.reason && existing.ptyId === d.ptyId) {
        return s;
      }
      return { driftByWorktree: { ...s.driftByWorktree, [d.toWorktree]: d } };
    }),

  dismissWorktreeOpen: (toWorktree) =>
    set((s) => {
      if (!s.driftByWorktree[toWorktree]) return s;
      const next = { ...s.driftByWorktree };
      delete next[toWorktree];
      return { driftByWorktree: next };
    }),

  dismissDriftByPty: (ptyId) =>
    set((s) => {
      const entries = Object.entries(s.driftByWorktree).filter(
        ([, d]) => d.ptyId !== ptyId,
      );
      if (entries.length === Object.keys(s.driftByWorktree).length) return s;
      return { driftByWorktree: Object.fromEntries(entries) };
    }),
});
