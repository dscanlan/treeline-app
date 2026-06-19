import type { StateCreator } from 'zustand';

/**
 * Transient "your terminals were restored" feedback shown after a reload
 * re-adopts the PTYs that survived in the main process (see ipc/client.ts
 * `reattachPtys`). Without it the panes just sit blank for the moment it takes
 * each xterm to replay its buffer, with nothing telling the user their sessions
 * are coming back rather than something being broken. Ephemeral — never
 * persisted; it's a one-shot notice the toast auto-dismisses.
 */
export interface ReattachSlice {
  /** Set when a reload restored ≥1 terminal; null otherwise. `at` drives the auto-dismiss. */
  reattachNotice: { count: number; at: number } | null;
  /** Announce that `count` terminals were re-adopted (no-op for count ≤ 0). */
  noteReattached: (count: number) => void;
  /** Clear the notice (auto-dismiss timeout, or a manual close). */
  clearReattachNotice: () => void;
}

export const createReattachSlice: StateCreator<ReattachSlice, [], [], ReattachSlice> = (
  set,
) => ({
  reattachNotice: null,
  noteReattached: (count) =>
    set(() => (count > 0 ? { reattachNotice: { count, at: Date.now() } } : {})),
  clearReattachNotice: () => set({ reattachNotice: null }),
});
