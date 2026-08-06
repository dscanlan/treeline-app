import type { StateCreator } from 'zustand';
import type { ChangedFile, DirEntry, FileContents, FileDiff } from '@shared/types';
import { sanitizePinnedFilePaths, togglePinnedFilePath } from '@shared/file-pins';

const FILE_PINS_STORAGE_KEY = 'treeline.pinnedFilePaths';

function loadPersistedFilePins(): string[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    return sanitizePinnedFilePaths(JSON.parse(localStorage.getItem(FILE_PINS_STORAGE_KEY) ?? '[]'));
  } catch {
    return [];
  }
}

function persistFilePins(paths: string[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(FILE_PINS_STORAGE_KEY, JSON.stringify(paths));
  } catch {
    // Best-effort renderer preference, matching the other sidebar pins.
  }
}

/** Which view a worktree's expanded file area is showing. */
export type WorktreeFileView = 'all' | 'changed';

/**
 * Whether the code panel renders the full file (raw source), its diff, or — for
 * markdown files — a rendered Preview. Preview shares the file's text with the
 * File view (`openFileText`); it's just a different renderer over the same data.
 */
export type PanelMode = 'file' | 'diff' | 'preview';

/** Clamp bounds for the resizable code panel (px). */
export const CODE_PANEL_MIN_WIDTH = 280;
export const CODE_PANEL_MAX_WIDTH = 1000;
export const CODE_PANEL_DEFAULT_WIDTH = 480;

export interface EditorSlice {
  /** Whether the split code panel is visible in MainArea. */
  codePanelOpen: boolean;
  /** Width of the code panel in px (the terminal takes the remaining space). */
  codePanelWidth: number;

  /** Path of the file currently shown in the panel (null = nothing loaded). */
  openFilePath: string | null;
  /** Whether the panel is showing the full file or its diff. */
  panelMode: PanelMode;

  /**
   * Line to scroll to + highlight in the File view (1-based), set when a search
   * hit is opened. `revealTick` bumps on every request so re-selecting the same
   * line re-fires the scroll even though `revealLine` is unchanged.
   */
  revealLine: number | null;
  revealTick: number;

  openFileText: string | null;
  openFileTruncated: boolean;
  openFileBinary: boolean;
  openFileError: string | null;
  openFileLoading: boolean;

  /** Diff representation of the open file (lazily loaded). */
  openDiff: FileDiff | null;
  diffError: string | null;
  diffLoading: boolean;

  /**
   * Edit state for the File view. `editing` flips the read-only viewer into an
   * editor; `draft` holds the in-progress text (compared against `openFileText`
   * to know if there are unsaved changes). Diff view and truncated files are
   * never editable.
   */
  editing: boolean;
  draft: string | null;
  saving: boolean;
  saveError: string | null;

  /** Tree state: dir path → expanded, and dir path → lazily-loaded children. */
  expandedDirs: Record<string, boolean>;
  dirChildren: Record<string, DirEntry[]>;

  /** Per-worktree "All | Changed" view mode (defaults to 'all' when absent). */
  worktreeFileView: Record<string, WorktreeFileView>;
  /** Per-worktree cached changed-file list (from files.changed). */
  changedByWorktree: Record<string, ChangedFile[]>;
  /** Per-worktree in-flight flag for the changed-file fetch. */
  changedLoading: Record<string, boolean>;

  /** Global file shortcuts, newest first, persisted in renderer localStorage. */
  pinnedFilePaths: string[];
  /** Pinned paths confirmed absent on disk. Presence with `true` means missing. */
  missingPinnedFiles: Record<string, boolean>;

  setCodePanelWidth: (w: number) => void;
  closeCodePanel: () => void;

  /**
   * Open `path` in the panel in the given mode, clearing both the file and diff
   * representations and marking that mode loading. The action layer then fetches
   * the chosen representation.
   */
  openInPanel: (path: string, mode: PanelMode) => void;
  /** Switch the panel between file and diff for the already-open path. */
  setPanelMode: (mode: PanelMode) => void;

  /** Request the File view scroll to + highlight `line` (1-based); null clears. */
  setRevealLine: (line: number | null) => void;

  /** Mark the file read in-flight (used when lazily loading on a mode switch). */
  setFileLoading: (loading: boolean) => void;
  /** Apply a successful read result. Ignored if the user already switched files. */
  applyFileResult: (result: FileContents) => void;
  /** Record a read failure for `path`. Ignored if the user already switched. */
  setFileError: (path: string, error: string) => void;

  /** Mark the diff fetch in-flight (used when lazily loading on a mode switch). */
  setDiffLoading: (loading: boolean) => void;
  /** Apply a diff result. Ignored if the user already switched files. */
  applyDiffResult: (diff: FileDiff) => void;
  /** Record a diff failure for `path`. Ignored if the user already switched. */
  setDiffError: (path: string, error: string) => void;

  /** Cache a directory's children (from files.readDir). */
  setDirChildren: (path: string, entries: DirEntry[]) => void;
  /** Flip a directory's expanded flag. */
  setDirExpanded: (path: string, expanded: boolean) => void;

  /** Enter edit mode for the open file (seeds `draft` from the loaded text). */
  startEditing: () => void;
  /** Update the in-progress draft as the user types. */
  setDraft: (text: string) => void;
  /** Leave edit mode and drop the draft (caller handles any unsaved warning). */
  stopEditing: () => void;
  /** Mark a save in-flight. */
  setSaving: (saving: boolean) => void;
  /** Apply a successful save: `content` becomes the new clean baseline. */
  applySaved: (path: string, content: string) => void;
  /** Record a save failure for `path`. Ignored if the user already switched. */
  setSaveError: (path: string, error: string) => void;

  /** Set a worktree's All|Changed view mode. */
  setWorktreeFileView: (worktreePath: string, view: WorktreeFileView) => void;
  /** Mark the changed-file fetch in-flight for a worktree. */
  setChangedLoading: (worktreePath: string, loading: boolean) => void;
  /** Cache a worktree's changed-file list (clears its loading flag). */
  setChangedFiles: (worktreePath: string, files: ChangedFile[]) => void;
  /** Add a new file pin at the top, or remove an existing one. */
  togglePinnedFile: (path: string) => void;
  /** Mark or clear a pin's last-known missing status. */
  setPinnedFileMissing: (path: string, missing: boolean) => void;
}

export const createEditorSlice: StateCreator<EditorSlice, [], [], EditorSlice> = (set) => ({
  codePanelOpen: false,
  codePanelWidth: CODE_PANEL_DEFAULT_WIDTH,

  openFilePath: null,
  panelMode: 'file',
  revealLine: null,
  revealTick: 0,
  openFileText: null,
  openFileTruncated: false,
  openFileBinary: false,
  openFileError: null,
  openFileLoading: false,
  openDiff: null,
  diffError: null,
  diffLoading: false,

  editing: false,
  draft: null,
  saving: false,
  saveError: null,

  expandedDirs: {},
  dirChildren: {},

  worktreeFileView: {},
  changedByWorktree: {},
  changedLoading: {},
  pinnedFilePaths: loadPersistedFilePins(),
  missingPinnedFiles: {},

  setCodePanelWidth: (w) =>
    set({
      codePanelWidth: Math.max(CODE_PANEL_MIN_WIDTH, Math.min(CODE_PANEL_MAX_WIDTH, w)),
    }),

  closeCodePanel: () => set({ codePanelOpen: false }),

  openInPanel: (path, mode) =>
    set({
      codePanelOpen: true,
      openFilePath: path,
      panelMode: mode,
      // A plain open (tree/changed click) clears any prior reveal target; an
      // open-at-line follows up with setRevealLine after this.
      revealLine: null,
      openFileText: null,
      openFileTruncated: false,
      openFileBinary: false,
      openFileError: null,
      // Preview reads the same file text as the File view, so both load it.
      openFileLoading: mode === 'file' || mode === 'preview',
      openDiff: null,
      diffError: null,
      diffLoading: mode === 'diff',
      // Switching files always leaves edit mode (the guard runs first).
      editing: false,
      draft: null,
      saving: false,
      saveError: null,
    }),

  setPanelMode: (mode) => set({ panelMode: mode }),

  setRevealLine: (line) => set((s) => ({ revealLine: line, revealTick: s.revealTick + 1 })),

  setFileLoading: (loading) => set({ openFileLoading: loading }),

  applyFileResult: (result) =>
    set((s) => {
      // A slow read for a file the user already navigated away from must not
      // clobber the newer selection.
      if (s.openFilePath !== result.path) return s;
      return {
        openFileText: result.text,
        openFileTruncated: result.truncated,
        openFileBinary: result.binary,
        openFileError: null,
        openFileLoading: false,
      };
    }),

  setFileError: (path, error) =>
    set((s) => {
      if (s.openFilePath !== path) return s;
      return { openFileError: error, openFileLoading: false };
    }),

  setDiffLoading: (loading) => set({ diffLoading: loading }),

  applyDiffResult: (diff) =>
    set((s) => {
      if (s.openFilePath !== diff.path) return s;
      return { openDiff: diff, diffError: null, diffLoading: false };
    }),

  setDiffError: (path, error) =>
    set((s) => {
      if (s.openFilePath !== path) return s;
      return { diffError: error, diffLoading: false };
    }),

  setDirChildren: (path, entries) =>
    set((s) => ({ dirChildren: { ...s.dirChildren, [path]: entries } })),

  setDirExpanded: (path, expanded) =>
    set((s) => ({ expandedDirs: { ...s.expandedDirs, [path]: expanded } })),

  startEditing: () =>
    set((s) => ({ editing: true, draft: s.openFileText ?? '', saveError: null })),

  setDraft: (text) => set({ draft: text }),

  stopEditing: () => set({ editing: false, draft: null, saving: false, saveError: null }),

  setSaving: (saving) => set({ saving }),

  applySaved: (path, content) =>
    set((s) => {
      if (s.openFilePath !== path) return s;
      // `content` becomes the new clean baseline. We deliberately do NOT touch
      // `draft`: if the user kept typing during the write, their newer draft
      // stays put and the unsaved indicator (draft !== openFileText) re-arms.
      return { openFileText: content, saving: false, saveError: null };
    }),

  setSaveError: (path, error) =>
    set((s) => {
      if (s.openFilePath !== path) return s;
      return { saveError: error, saving: false };
    }),

  setWorktreeFileView: (worktreePath, view) =>
    set((s) => ({ worktreeFileView: { ...s.worktreeFileView, [worktreePath]: view } })),

  setChangedLoading: (worktreePath, loading) =>
    set((s) => ({ changedLoading: { ...s.changedLoading, [worktreePath]: loading } })),

  setChangedFiles: (worktreePath, files) =>
    set((s) => ({
      changedByWorktree: { ...s.changedByWorktree, [worktreePath]: files },
      changedLoading: { ...s.changedLoading, [worktreePath]: false },
    })),

  togglePinnedFile: (path) =>
    set((s) => {
      const pinnedFilePaths = togglePinnedFilePath(s.pinnedFilePaths, path);
      const missingPinnedFiles = { ...s.missingPinnedFiles };
      if (!pinnedFilePaths.includes(path)) delete missingPinnedFiles[path];
      persistFilePins(pinnedFilePaths);
      return { pinnedFilePaths, missingPinnedFiles };
    }),

  setPinnedFileMissing: (path, missing) =>
    set((s) => {
      const missingPinnedFiles = { ...s.missingPinnedFiles };
      if (missing) missingPinnedFiles[path] = true;
      else delete missingPinnedFiles[path];
      return { missingPinnedFiles };
    }),
});
