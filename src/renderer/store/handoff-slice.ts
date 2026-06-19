import type { StateCreator } from 'zustand';

/**
 * A session handoff: the user resumed a pane's Claude conversation inside a
 * worktree, so the **origin** pane was SIGSTOP-parked (in main) to guarantee the
 * two copies of the same conversation never run at once. This record links the
 * parked origin to its resumed worktree fork so the UI can show the parked state
 * and offer "return to original" — which thaws the origin and kills the fork.
 */
export interface Handoff {
  /** pty id of the parked (frozen) origin pane — the map key. */
  originPtyId: string;
  /** Tab the origin pane lives in, to re-focus on return. */
  originTabId: string;
  /** cwd of the origin session (the parent repo), for sidebar selection. */
  originCwd: string;
  /** The worktree the conversation was resumed into. */
  worktreeCwd: string;
  /** Tab id of the resumed worktree fork, to close when returning to origin. */
  forkTabId: string;
}

export interface HandoffSlice {
  /**
   * Active handoffs keyed by parked origin pty id. Transient session state —
   * never persisted (a frozen process can't survive a reload anyway).
   */
  handoffByOriginPty: Record<string, Handoff>;

  /** Record a park↔fork link (called after the origin pane is paused). */
  recordHandoff: (h: Handoff) => void;
  /** Forget a handoff (origin thawed, or either side's tab closed). */
  clearHandoff: (originPtyId: string) => void;
  /** The handoff whose fork is `forkTabId`, if any — used to unpark on close. */
  handoffForFork: (forkTabId: string) => Handoff | null;
}

export const createHandoffSlice: StateCreator<HandoffSlice, [], [], HandoffSlice> = (
  set,
  get,
) => ({
  handoffByOriginPty: {},

  recordHandoff: (h) =>
    set((s) => ({
      handoffByOriginPty: { ...s.handoffByOriginPty, [h.originPtyId]: h },
    })),

  clearHandoff: (originPtyId) =>
    set((s) => {
      if (!s.handoffByOriginPty[originPtyId]) return s;
      const next = { ...s.handoffByOriginPty };
      delete next[originPtyId];
      return { handoffByOriginPty: next };
    }),

  handoffForFork: (forkTabId) =>
    Object.values(get().handoffByOriginPty).find((h) => h.forkTabId === forkTabId) ??
    null,
});
