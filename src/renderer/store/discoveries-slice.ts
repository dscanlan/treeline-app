import type { StateCreator } from 'zustand';

export interface DiscoveredRepo {
  repoPath: string;
  viaCwd: string;
}

export interface DiscoveriesSlice {
  /**
   * FIFO queue of untracked repos surfaced by main. The toast renders the
   * head of the queue. Deduped by repoPath so multiple cwd-changes inside
   * the same untracked repo don't stack into multiple toasts.
   *
   * Persisted to localStorage so a discovery seen mid-session isn't lost
   * when the user quits before acting on it. The cap defends against an
   * (extremely unlikely) runaway accumulation while disconnected from main.
   */
  pendingDiscoveries: DiscoveredRepo[];

  enqueueDiscovery: (d: DiscoveredRepo) => void;
  /** Drop a single discovery from the queue (does not persist anything). */
  dismissDiscovery: (repoPath: string) => void;
}

const STORAGE_KEY = 'treeline.pendingDiscoveries';
const QUEUE_MAX = 32;

function loadPersisted(): DiscoveredRepo[] {
  // Guard: store creation runs at module load. In an Electron renderer
  // localStorage is always available, but tests / SSR contexts may not have it.
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (d): d is DiscoveredRepo =>
          !!d &&
          typeof d === 'object' &&
          typeof (d as DiscoveredRepo).repoPath === 'string' &&
          typeof (d as DiscoveredRepo).viaCwd === 'string',
      )
      .slice(0, QUEUE_MAX);
  } catch {
    return [];
  }
}

function persist(arr: DiscoveredRepo[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
  } catch {
    // Quota exceeded / private mode — silently best-effort. The toast just
    // won't survive a restart in that case, which matches the pre-persistence
    // behavior.
  }
}

export const createDiscoveriesSlice: StateCreator<
  DiscoveriesSlice,
  [],
  [],
  DiscoveriesSlice
> = (set) => ({
  pendingDiscoveries: loadPersisted(),

  enqueueDiscovery: (d) =>
    set((s) => {
      if (s.pendingDiscoveries.some((p) => p.repoPath === d.repoPath)) return s;
      const next = [...s.pendingDiscoveries, d].slice(-QUEUE_MAX);
      persist(next);
      return { pendingDiscoveries: next };
    }),

  dismissDiscovery: (repoPath) =>
    set((s) => {
      const next = s.pendingDiscoveries.filter((p) => p.repoPath !== repoPath);
      if (next.length === s.pendingDiscoveries.length) return s;
      persist(next);
      return { pendingDiscoveries: next };
    }),
});
