import type { StateCreator } from 'zustand';
import type { NoteIndex } from '@shared/note-link';

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
}

export const createVaultSlice: StateCreator<VaultSlice, [], [], VaultSlice> = (set) => ({
  noteIndexByRoot: {},
  setNoteIndex: (root, index) =>
    set((s) => ({ noteIndexByRoot: { ...s.noteIndexByRoot, [root]: index } })),
});
