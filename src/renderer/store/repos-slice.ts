import type { StateCreator } from 'zustand';
import type { Repo, Worktree } from '@shared/types';

/** Clamp bounds for the resizable sidebar (px). */
export const SIDEBAR_MIN_WIDTH = 180;
export const SIDEBAR_MAX_WIDTH = 600;
export const SIDEBAR_DEFAULT_WIDTH = 256;

const WIDTH_STORAGE_KEY = 'treeline.sidebarWidth';

function loadPersistedWidth(): number {
  // Guard: store creation runs at module load. In an Electron renderer
  // localStorage is always available, but tests / SSR contexts may not have it.
  if (typeof localStorage === 'undefined') return SIDEBAR_DEFAULT_WIDTH;
  try {
    const n = Number(localStorage.getItem(WIDTH_STORAGE_KEY));
    if (!Number.isFinite(n) || n === 0) return SIDEBAR_DEFAULT_WIDTH;
    return Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, n));
  } catch {
    return SIDEBAR_DEFAULT_WIDTH;
  }
}

function persistWidth(w: number): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(WIDTH_STORAGE_KEY, String(w));
  } catch {
    // Quota exceeded / private mode — best-effort; the width just won't
    // survive a restart.
  }
}

export interface ReposSlice {
  repos: Repo[];
  worktreesByRepo: Record<string, Worktree[]>;
  selectedSidebarPath: string | null;
  /**
   * Scratch terminal id selected in the sidebar. Mutually exclusive with
   * `selectedSidebarPath`: the setters below enforce the invariant that at
   * most one of these is non-null at a time. Kept as a parallel field rather
   * than a discriminated union to avoid touching the eight existing call
   * sites that compare `selectedSidebarPath` to a worktree path.
   */
  selectedScratchId: string | null;
  filter: string;
  sidebarCollapsed: boolean;
  /** Sidebar width in px when expanded. Persisted to localStorage. */
  sidebarWidth: number;
  /**
   * True while the user is dragging the sidebar resize handle. The sidebar
   * drops its width transition during the drag so it tracks the cursor
   * instead of lagging behind by an animation frame.
   */
  sidebarResizing: boolean;

  setRepos: (repos: Repo[]) => void;
  setWorktrees: (repoPath: string, worktrees: Worktree[]) => void;
  setSelected: (path: string | null) => void;
  setSelectedScratch: (id: string | null) => void;
  setFilter: (s: string) => void;
  setSidebarCollapsed: (v: boolean) => void;
  setSidebarWidth: (w: number) => void;
  setSidebarResizing: (v: boolean) => void;
}

export const createReposSlice: StateCreator<ReposSlice, [], [], ReposSlice> = (set) => ({
  repos: [],
  worktreesByRepo: {},
  selectedSidebarPath: null,
  selectedScratchId: null,
  filter: '',
  sidebarCollapsed: false,
  sidebarWidth: loadPersistedWidth(),
  sidebarResizing: false,

  setRepos: (repos) => set({ repos }),
  setWorktrees: (repoPath, worktrees) =>
    set((s) => ({ worktreesByRepo: { ...s.worktreesByRepo, [repoPath]: worktrees } })),
  // Selecting a worktree clears any scratch selection (and vice versa) so
  // exactly one row in the sidebar appears highlighted at a time.
  setSelected: (path) => set({ selectedSidebarPath: path, selectedScratchId: null }),
  setSelectedScratch: (id) => set({ selectedScratchId: id, selectedSidebarPath: null }),
  setFilter: (filter) => set({ filter }),
  setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
  setSidebarWidth: (w) => {
    const sidebarWidth = Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, w));
    persistWidth(sidebarWidth);
    set({ sidebarWidth });
  },
  setSidebarResizing: (sidebarResizing) => set({ sidebarResizing }),
});
