// Renderer-only state for scratch terminals: shells the user opened from the
// sidebar without picking a repo. Ephemeral — never persisted to disk — so the
// slice lives entirely in memory and is cleared on app reload. The `Scratch`
// shape itself lives in @shared/types so the screenshot harness in the main
// process can build scratch fixtures for capture scenarios.
import type { StateCreator } from 'zustand';
import type { Scratch } from '@shared/types';

export type { Scratch };

export interface ScratchSlice {
  scratches: Scratch[];
  addScratch: (s: Scratch) => void;
  removeScratchById: (id: string) => void;
  /**
   * Smallest positive integer N such that no existing scratch is labeled
   * exactly `Scratch N`. Lets labels stay dense after closures: if Scratch 1
   * is closed while Scratch 2 lives, the next new one is "Scratch 1".
   */
  nextScratchNumber: () => number;
}

export const createScratchSlice: StateCreator<ScratchSlice, [], [], ScratchSlice> = (
  set,
  get,
) => ({
  scratches: [],

  addScratch: (s) => set((state) => ({ scratches: [...state.scratches, s] })),

  removeScratchById: (id) =>
    set((state) => ({ scratches: state.scratches.filter((s) => s.id !== id) })),

  nextScratchNumber: () => {
    const taken = new Set<number>();
    for (const s of get().scratches) {
      const m = /^Scratch (\d+)$/.exec(s.label);
      if (m && m[1]) {
        const n = Number.parseInt(m[1], 10);
        if (Number.isInteger(n) && n > 0) taken.add(n);
      }
    }
    // Linear scan — scratch counts will never be high enough for a heap.
    for (let i = 1; ; i++) {
      if (!taken.has(i)) return i;
    }
  },
});
