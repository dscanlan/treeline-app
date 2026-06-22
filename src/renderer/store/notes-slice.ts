import type { StateCreator } from 'zustand';

/** Clamp bounds for the resizable scratchpad panel (px). */
export const NOTES_PANEL_MIN_WIDTH = 320;
export const NOTES_PANEL_MAX_WIDTH = 1200;
export const NOTES_PANEL_DEFAULT_WIDTH = 480;

/**
 * State for the scratchpad panel (NotesPanel) — a single, always-available
 * plain-text buffer for the quick copy → clean → paste loop between terminals
 * and agent chats. The buffer is persisted to `scratchpad.json` (see
 * src/main/scratchpad-store.ts); this slice is the React-side view of it.
 *
 * The scratchpad shares the right-hand auxiliary slot with the embedded browser
 * (they're mutually exclusive — opening one closes the other). That coordination
 * lives at the toggle layer (renderer/ipc/client.ts) + the MainArea render
 * guard, not here, so this slice stays a plain, self-contained piece of state.
 */
export interface NotesSlice {
  /** Whether the scratchpad panel is visible in MainArea. */
  notesPanelOpen: boolean;
  /** Width of the scratchpad panel in px (the terminal takes the remaining space). */
  notesPanelWidth: number;
  /** The scratchpad buffer text. Persisted via the scratchpad IPC. */
  scratchpadText: string;

  setNotesPanelWidth: (w: number) => void;
  openNotesPanel: () => void;
  closeNotesPanel: () => void;
  toggleNotesPanel: () => void;
  setScratchpadText: (text: string) => void;
}

export const createNotesSlice: StateCreator<NotesSlice, [], [], NotesSlice> = (set) => ({
  notesPanelOpen: false,
  notesPanelWidth: NOTES_PANEL_DEFAULT_WIDTH,
  scratchpadText: '',

  setNotesPanelWidth: (w) =>
    set({
      notesPanelWidth: Math.max(
        NOTES_PANEL_MIN_WIDTH,
        Math.min(NOTES_PANEL_MAX_WIDTH, w),
      ),
    }),

  openNotesPanel: () => set({ notesPanelOpen: true }),
  closeNotesPanel: () => set({ notesPanelOpen: false }),
  toggleNotesPanel: () => set((s) => ({ notesPanelOpen: !s.notesPanelOpen })),

  setScratchpadText: (text) => set({ scratchpadText: text }),
});
