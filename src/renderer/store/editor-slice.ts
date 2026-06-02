import type { StateCreator } from 'zustand';
import type { ChangedFile, DirEntry, FileContents, FileDiff } from '@shared/types';

/** Which view a worktree's expanded file area is showing. */
export type WorktreeFileView = 'all' | 'changed';

/** Whether the code panel renders the full file or its diff. */
export type PanelMode = 'file' | 'diff';

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

  openFileText: string | null;
  openFileTruncated: boolean;
  openFileBinary: boolean;
  openFileError: string | null;
  openFileLoading: boolean;

  /** Diff representation of the open file (lazily loaded). */
  openDiff: FileDiff | null;
  diffError: string | null;
  diffLoading: boolean;

  /** Tree state: dir path → expanded, and dir path → lazily-loaded children. */
  expandedDirs: Record<string, boolean>;
  dirChildren: Record<string, DirEntry[]>;

  /** Per-worktree "All | Changed" view mode (defaults to 'all' when absent). */
  worktreeFileView: Record<string, WorktreeFileView>;
  /** Per-worktree cached changed-file list (from files.changed). */
  changedByWorktree: Record<string, ChangedFile[]>;
  /** Per-worktree in-flight flag for the changed-file fetch. */
  changedLoading: Record<string, boolean>;

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

  /** Set a worktree's All|Changed view mode. */
  setWorktreeFileView: (worktreePath: string, view: WorktreeFileView) => void;
  /** Mark the changed-file fetch in-flight for a worktree. */
  setChangedLoading: (worktreePath: string, loading: boolean) => void;
  /** Cache a worktree's changed-file list (clears its loading flag). */
  setChangedFiles: (worktreePath: string, files: ChangedFile[]) => void;
}

export const createEditorSlice: StateCreator<EditorSlice, [], [], EditorSlice> = (set) => ({
  codePanelOpen: false,
  codePanelWidth: CODE_PANEL_DEFAULT_WIDTH,

  openFilePath: null,
  panelMode: 'file',
  openFileText: null,
  openFileTruncated: false,
  openFileBinary: false,
  openFileError: null,
  openFileLoading: false,
  openDiff: null,
  diffError: null,
  diffLoading: false,

  expandedDirs: {},
  dirChildren: {},

  worktreeFileView: {},
  changedByWorktree: {},
  changedLoading: {},

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
      openFileText: null,
      openFileTruncated: false,
      openFileBinary: false,
      openFileError: null,
      openFileLoading: mode === 'file',
      openDiff: null,
      diffError: null,
      diffLoading: mode === 'diff',
    }),

  setPanelMode: (mode) => set({ panelMode: mode }),

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

  setWorktreeFileView: (worktreePath, view) =>
    set((s) => ({ worktreeFileView: { ...s.worktreeFileView, [worktreePath]: view } })),

  setChangedLoading: (worktreePath, loading) =>
    set((s) => ({ changedLoading: { ...s.changedLoading, [worktreePath]: loading } })),

  setChangedFiles: (worktreePath, files) =>
    set((s) => ({
      changedByWorktree: { ...s.changedByWorktree, [worktreePath]: files },
      changedLoading: { ...s.changedLoading, [worktreePath]: false },
    })),
});
