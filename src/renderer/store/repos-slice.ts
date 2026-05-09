import type { StateCreator } from 'zustand';
import type { Repo, Worktree } from '@shared/types';

export interface ReposSlice {
  repos: Repo[];
  worktreesByRepo: Record<string, Worktree[]>;
  selectedSidebarPath: string | null;
  filter: string;
  sidebarCollapsed: boolean;

  setRepos: (repos: Repo[]) => void;
  setWorktrees: (repoPath: string, worktrees: Worktree[]) => void;
  setSelected: (path: string | null) => void;
  setFilter: (s: string) => void;
  setSidebarCollapsed: (v: boolean) => void;
}

export const createReposSlice: StateCreator<ReposSlice, [], [], ReposSlice> = (set) => ({
  repos: [],
  worktreesByRepo: {},
  selectedSidebarPath: null,
  filter: '',
  sidebarCollapsed: false,

  setRepos: (repos) => set({ repos }),
  setWorktrees: (repoPath, worktrees) =>
    set((s) => ({ worktreesByRepo: { ...s.worktreesByRepo, [repoPath]: worktrees } })),
  setSelected: (path) => set({ selectedSidebarPath: path }),
  setFilter: (filter) => set({ filter }),
  setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
});
