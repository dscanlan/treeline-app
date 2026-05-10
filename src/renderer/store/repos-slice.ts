import type { StateCreator } from 'zustand';
import type { Repo, Worktree } from '@shared/types';

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

  setRepos: (repos: Repo[]) => void;
  setWorktrees: (repoPath: string, worktrees: Worktree[]) => void;
  setSelected: (path: string | null) => void;
  setSelectedScratch: (id: string | null) => void;
  setFilter: (s: string) => void;
  setSidebarCollapsed: (v: boolean) => void;
}

export const createReposSlice: StateCreator<ReposSlice, [], [], ReposSlice> = (set) => ({
  repos: [],
  worktreesByRepo: {},
  selectedSidebarPath: null,
  selectedScratchId: null,
  filter: '',
  sidebarCollapsed: false,

  setRepos: (repos) => set({ repos }),
  setWorktrees: (repoPath, worktrees) =>
    set((s) => ({ worktreesByRepo: { ...s.worktreesByRepo, [repoPath]: worktrees } })),
  // Selecting a worktree clears any scratch selection (and vice versa) so
  // exactly one row in the sidebar appears highlighted at a time.
  setSelected: (path) => set({ selectedSidebarPath: path, selectedScratchId: null }),
  setSelectedScratch: (id) => set({ selectedScratchId: id, selectedSidebarPath: null }),
  setFilter: (filter) => set({ filter }),
  setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
});
