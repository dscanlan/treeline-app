import type { StateCreator } from 'zustand';
import type { NoteIndex } from '@shared/note-link';

/**
 * How opening a file affects the note-navigation history (the breadcrumb trail
 * behind the Preview's back button):
 * - 'push'  — a note-link click; the file being left joins the trail.
 * - 'clear' — a fresh navigation (tree, quick-open, search, diff); the trail
 *   from the previous document is over.
 * - { truncateTo } — a back/breadcrumb jump; entries above the target drop off.
 */
export type NoteHistoryBehavior = 'push' | 'clear' | { truncateTo: number };

/** Oldest entries drop off beyond this, so a link-hopping session can't grow the stack unbounded. */
export const NOTE_HISTORY_MAX = 50;

/**
 * Per-root note indexes for resolving `[[wikilinks]]` in the markdown preview.
 * Keyed by the containing root (the configured vault path, a pinned folder, or
 * a worktree) so several vaults/repos can hold indexes at once. Built from the
 * `search.files` listing by `actions/vault.ts`; session-only, never persisted —
 * there's no fs watcher on plain folders, so staleness is bounded by the
 * rebuild-per-note-open in MarkdownView.
 */
export interface VaultSlice {
  noteIndexByRoot: Record<string, NoteIndex>;
  setNoteIndex: (root: string, index: NoteIndex) => void;

  /**
   * Breadcrumb trail of note paths the user link-clicked away from, oldest
   * first (the currently-open file is NOT in it). Session-only; grows only via
   * note-link navigation and empties on any other open or on panel close.
   */
  noteHistory: string[];
  pushNoteHistory: (path: string) => void;
  /** Keep the first `count` entries (a back/breadcrumb jump landed on index `count`). */
  truncateNoteHistory: (count: number) => void;
  clearNoteHistory: () => void;
}

export const createVaultSlice: StateCreator<VaultSlice, [], [], VaultSlice> = (set) => ({
  noteIndexByRoot: {},
  setNoteIndex: (root, index) =>
    set((s) => ({ noteIndexByRoot: { ...s.noteIndexByRoot, [root]: index } })),

  noteHistory: [],
  pushNoteHistory: (path) =>
    set((s) => ({ noteHistory: [...s.noteHistory, path].slice(-NOTE_HISTORY_MAX) })),
  truncateNoteHistory: (count) =>
    set((s) =>
      count >= s.noteHistory.length ? s : { noteHistory: s.noteHistory.slice(0, count) },
    ),
  clearNoteHistory: () => set((s) => (s.noteHistory.length === 0 ? s : { noteHistory: [] })),
});
