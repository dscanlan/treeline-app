import type { StateCreator } from 'zustand';
import type { PersistedSession } from '@shared/types';

/**
 * Cold-start tab restore. On a fresh launch where no PTYs survived (an
 * auto-update relaunch, a reboot — main died, so `reattachPtys` finds nothing)
 * and a non-empty session was saved to disk, `pendingRestore` holds it and the
 * `RestorePrompt` modal offers to bring the tabs back. Nothing respawns (and no
 * `claude --resume` runs) until the user confirms — so this is gated behind the
 * prompt, unlike the silent reload-time reattach.
 *
 * `restoreNotice` is the post-restore confirmation toast (mirrors
 * `reattach-slice`): how many tabs came back, and how many were skipped because
 * their worktree had been removed. Both pieces are ephemeral — never persisted.
 */
export interface RestoreSlice {
  /** The saved session awaiting a Restore/Dismiss decision, or null. */
  pendingRestore: PersistedSession | null;
  /** Set after a restore completes; drives the confirmation toast + auto-dismiss. */
  restoreNotice: { count: number; skipped: number; at: number } | null;

  /** Offer to restore `session` (cold start with a saved, non-empty layout). */
  setPendingRestore: (session: PersistedSession) => void;
  /** Clear the pending offer (taken or dismissed). */
  clearPendingRestore: () => void;
  /** Announce that `count` tabs were restored (`skipped` had a missing worktree). */
  noteRestored: (count: number, skipped: number) => void;
  /** Clear the confirmation toast (auto-dismiss timeout, or a manual close). */
  clearRestoreNotice: () => void;
}

export const createRestoreSlice: StateCreator<RestoreSlice, [], [], RestoreSlice> = (
  set,
) => ({
  pendingRestore: null,
  restoreNotice: null,
  setPendingRestore: (session) => set({ pendingRestore: session }),
  clearPendingRestore: () => set({ pendingRestore: null }),
  noteRestored: (count, skipped) =>
    set(() =>
      count > 0 || skipped > 0
        ? { restoreNotice: { count, skipped, at: Date.now() } }
        : {},
    ),
  clearRestoreNotice: () => set({ restoreNotice: null }),
});
