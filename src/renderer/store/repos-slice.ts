import type { StateCreator } from 'zustand';
import type { Folder, PrInfo, Repo, Worktree } from '@shared/types';
import {
  setSidebarRepoDisclosure,
  toggleSidebarLocation as toggleCollapsedLocation,
  type SidebarMode,
} from '@shared/sidebar-disclosure';

export type { SidebarMode } from '@shared/sidebar-disclosure';

/** Clamp bounds for the resizable sidebar (px). */
export const SIDEBAR_MIN_WIDTH = 180;
export const SIDEBAR_MAX_WIDTH = 600;
export const SIDEBAR_DEFAULT_WIDTH = 256;

const WIDTH_STORAGE_KEY = 'treeline.sidebarWidth';
const MODE_STORAGE_KEY = 'treeline.sidebarMode';
const PINS_STORAGE_KEY = 'treeline.sidebarPins';
const COLLAPSED_LOCATIONS_STORAGE_KEY = 'treeline.sidebarCollapsedLocations';
const REPO_OPEN_STORAGE_KEY = 'treeline.sidebarRepoOpen';

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

function loadPersistedMode(): SidebarMode {
  if (typeof localStorage === 'undefined') return 'working';
  try {
    return localStorage.getItem(MODE_STORAGE_KEY) === 'library' ? 'library' : 'working';
  } catch {
    return 'working';
  }
}

function persistMode(mode: SidebarMode): void {
  try {
    localStorage.setItem(MODE_STORAGE_KEY, mode);
  } catch {
    // Best-effort UI preference.
  }
}

function loadPersistedPins(): string[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(PINS_STORAGE_KEY) ?? '[]') as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((path): path is string => typeof path === 'string')
      : [];
  } catch {
    return [];
  }
}

function persistPins(paths: string[]): void {
  try {
    localStorage.setItem(PINS_STORAGE_KEY, JSON.stringify(paths));
  } catch {
    // Best-effort UI preference.
  }
}

function loadPersistedCollapsedLocations(): string[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const parsed = JSON.parse(
      localStorage.getItem(COLLAPSED_LOCATIONS_STORAGE_KEY) ?? '[]',
    ) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((path): path is string => typeof path === 'string')
      : [];
  } catch {
    return [];
  }
}

function persistCollapsedLocations(paths: string[]): void {
  try {
    localStorage.setItem(COLLAPSED_LOCATIONS_STORAGE_KEY, JSON.stringify(paths));
  } catch {
    // Best-effort UI preference.
  }
}

function loadPersistedRepoOpen(): Record<string, boolean> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(REPO_OPEN_STORAGE_KEY) ?? '{}') as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, boolean] => typeof entry[1] === 'boolean',
      ),
    );
  } catch {
    return {};
  }
}

function persistRepoOpen(repoOpen: Record<string, boolean>): void {
  try {
    localStorage.setItem(REPO_OPEN_STORAGE_KEY, JSON.stringify(repoOpen));
  } catch {
    // Best-effort UI preference.
  }
}

export interface ReposSlice {
  repos: Repo[];
  /** Plain (non-git) directories pinned to the sidebar as bare file trees. */
  folders: Folder[];
  worktreesByRepo: Record<string, Worktree[]>;
  /**
   * GitHub PR status keyed by repo path → branch name → PrInfo. Populated from
   * the PR monitor's `pr:update` broadcasts (and the initial `pr:snapshot`).
   * `WorktreeRow` looks up `prByRepoBranch[repoPath]?.[worktree.branch]`.
   */
  prByRepoBranch: Record<string, Record<string, PrInfo>>;
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
  /** Operational targets or the full registered catalog. */
  sidebarMode: SidebarMode;
  /** Worktree/folder paths manually retained in the Working view. */
  sidebarPins: string[];
  /** Parent-directory groups the user collapsed in the Library. Missing means open. */
  sidebarCollapsedLocations: string[];
  /** Explicit repo disclosure state, keyed by mode + absolute repo path. */
  sidebarRepoOpen: Record<string, boolean>;
  /** A single target whose files replace the repo navigator. */
  sidebarFileRoot: string | null;
  /** Optional status-focused subset of either list mode. */
  sidebarAttentionOnly: boolean;
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
  setFolders: (folders: Folder[]) => void;
  setWorktrees: (repoPath: string, worktrees: Worktree[]) => void;
  /** Replace a single repo's branch→PR map (one PR-monitor broadcast). */
  setPrInfo: (repoPath: string, prByBranch: Record<string, PrInfo>) => void;
  /** Replace the whole repo→branch→PR index (initial snapshot hydrate). */
  setAllPrInfo: (prByRepoBranch: Record<string, Record<string, PrInfo>>) => void;
  setSelected: (path: string | null) => void;
  setSelectedScratch: (id: string | null) => void;
  setFilter: (s: string) => void;
  setSidebarMode: (mode: SidebarMode) => void;
  toggleSidebarPin: (path: string) => void;
  toggleSidebarLocation: (parentPath: string) => void;
  setSidebarRepoOpen: (mode: SidebarMode, repoPath: string, open: boolean) => void;
  setSidebarFileRoot: (path: string | null) => void;
  setSidebarAttentionOnly: (v: boolean) => void;
  setSidebarCollapsed: (v: boolean) => void;
  setSidebarWidth: (w: number) => void;
  setSidebarResizing: (v: boolean) => void;
}

export const createReposSlice: StateCreator<ReposSlice, [], [], ReposSlice> = (set) => ({
  repos: [],
  folders: [],
  worktreesByRepo: {},
  prByRepoBranch: {},
  selectedSidebarPath: null,
  selectedScratchId: null,
  filter: '',
  sidebarMode: loadPersistedMode(),
  sidebarPins: loadPersistedPins(),
  sidebarCollapsedLocations: loadPersistedCollapsedLocations(),
  sidebarRepoOpen: loadPersistedRepoOpen(),
  sidebarFileRoot: null,
  sidebarAttentionOnly: false,
  sidebarCollapsed: false,
  sidebarWidth: loadPersistedWidth(),
  sidebarResizing: false,

  setRepos: (repos) => set({ repos }),
  setFolders: (folders) => set({ folders }),
  setWorktrees: (repoPath, worktrees) =>
    set((s) => ({ worktreesByRepo: { ...s.worktreesByRepo, [repoPath]: worktrees } })),
  setPrInfo: (repoPath, prByBranch) =>
    set((s) => ({ prByRepoBranch: { ...s.prByRepoBranch, [repoPath]: prByBranch } })),
  setAllPrInfo: (prByRepoBranch) => set({ prByRepoBranch }),
  // Selecting a worktree clears any scratch selection (and vice versa) so
  // exactly one row in the sidebar appears highlighted at a time.
  setSelected: (path) => set({ selectedSidebarPath: path, selectedScratchId: null }),
  setSelectedScratch: (id) => set({ selectedScratchId: id, selectedSidebarPath: null }),
  setFilter: (filter) => set({ filter }),
  setSidebarMode: (sidebarMode) => {
    persistMode(sidebarMode);
    set({ sidebarMode, sidebarFileRoot: null });
  },
  toggleSidebarPin: (path) =>
    set((s) => {
      const sidebarPins = s.sidebarPins.includes(path)
        ? s.sidebarPins.filter((p) => p !== path)
        : [...s.sidebarPins, path];
      persistPins(sidebarPins);
      return { sidebarPins };
    }),
  toggleSidebarLocation: (parentPath) =>
    set((s) => {
      const sidebarCollapsedLocations = toggleCollapsedLocation(
        s.sidebarCollapsedLocations,
        parentPath,
      );
      persistCollapsedLocations(sidebarCollapsedLocations);
      return { sidebarCollapsedLocations };
    }),
  setSidebarRepoOpen: (mode, repoPath, open) =>
    set((s) => {
      const sidebarRepoOpen = setSidebarRepoDisclosure(s.sidebarRepoOpen, mode, repoPath, open);
      persistRepoOpen(sidebarRepoOpen);
      return { sidebarRepoOpen };
    }),
  setSidebarFileRoot: (sidebarFileRoot) => set({ sidebarFileRoot }),
  setSidebarAttentionOnly: (sidebarAttentionOnly) => set({ sidebarAttentionOnly }),
  setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
  setSidebarWidth: (w) => {
    const sidebarWidth = Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, w));
    persistWidth(sidebarWidth);
    set({ sidebarWidth });
  },
  setSidebarResizing: (sidebarResizing) => set({ sidebarResizing }),
});
