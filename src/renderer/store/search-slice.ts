import type { StateCreator } from 'zustand';
import type { ContentSearchOptions, ContentSearchResult } from '@shared/types';

/** Clamp bounds for the resizable search panel (px). */
export const SEARCH_PANEL_MIN_WIDTH = 280;
export const SEARCH_PANEL_MAX_WIDTH = 720;
export const SEARCH_PANEL_DEFAULT_WIDTH = 360;

/**
 * Find-in-files (⌘⇧F) state. Transient — never persisted (a stale result set
 * from a previous session would be misleading, and the root may be gone). The
 * panel shares the right-hand aux region with the code viewer via MainArea.
 */
export interface SearchSlice {
  /** Whether the find-in-files results panel is visible. */
  searchPanelOpen: boolean;
  /** Width of the search panel in px. */
  searchPanelWidth: number;
  /** The worktree/folder being searched (the selected sidebar target at open). */
  searchRoot: string | null;
  /** Current query text in the search box. */
  searchQuery: string;
  /** Match toggles (literal vs regex, case, whole-word). */
  searchOptions: ContentSearchOptions;

  /** Latest result set, or null before the first search / after a clear. */
  searchResults: ContentSearchResult | null;
  searchLoading: boolean;
  searchError: string | null;
  /** Per-file collapse state in the results tree, keyed by relPath. */
  collapsedFiles: Record<string, boolean>;

  /** Open the panel scoped to `root` (resets results if the root changed). */
  openSearchPanel: (root: string) => void;
  closeSearchPanel: () => void;
  setSearchPanelWidth: (w: number) => void;
  setSearchQuery: (q: string) => void;
  /** Toggle one match option (regex/caseSensitive/wholeWord). */
  toggleSearchOption: (key: keyof ContentSearchOptions) => void;
  setSearchLoading: (loading: boolean) => void;
  /** Apply a result. Ignored if `query`/`root` no longer match (stale response). */
  applySearchResults: (query: string, root: string, result: ContentSearchResult) => void;
  setSearchError: (error: string) => void;
  /** Flip a file's collapsed state in the results list. */
  toggleFileCollapsed: (relPath: string) => void;
}

export const createSearchSlice: StateCreator<SearchSlice, [], [], SearchSlice> = (set) => ({
  searchPanelOpen: false,
  searchPanelWidth: SEARCH_PANEL_DEFAULT_WIDTH,
  searchRoot: null,
  searchQuery: '',
  searchOptions: {},
  searchResults: null,
  searchLoading: false,
  searchError: null,
  collapsedFiles: {},

  openSearchPanel: (root) =>
    set((s) => {
      // Re-targeting a different worktree clears the previous results; reopening
      // the same one keeps them so ⌘⇧F toggles back to where you were.
      if (s.searchRoot === root) return { searchPanelOpen: true, searchRoot: root };
      return {
        searchPanelOpen: true,
        searchRoot: root,
        searchResults: null,
        searchError: null,
        collapsedFiles: {},
      };
    }),

  closeSearchPanel: () => set({ searchPanelOpen: false }),

  setSearchPanelWidth: (w) =>
    set({
      searchPanelWidth: Math.max(SEARCH_PANEL_MIN_WIDTH, Math.min(SEARCH_PANEL_MAX_WIDTH, w)),
    }),

  setSearchQuery: (q) => set({ searchQuery: q }),

  toggleSearchOption: (key) =>
    set((s) => ({ searchOptions: { ...s.searchOptions, [key]: !s.searchOptions[key] } })),

  setSearchLoading: (loading) => set({ searchLoading: loading }),

  applySearchResults: (query, root, result) =>
    set((s) => {
      if (s.searchQuery !== query || s.searchRoot !== root) return s;
      return { searchResults: result, searchLoading: false, searchError: null };
    }),

  setSearchError: (error) => set({ searchError: error, searchLoading: false }),

  toggleFileCollapsed: (relPath) =>
    set((s) => ({
      collapsedFiles: { ...s.collapsedFiles, [relPath]: !s.collapsedFiles[relPath] },
    })),
});
