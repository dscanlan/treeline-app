import type { StateCreator } from 'zustand';
import type { ChangedFile, DirEntry, FileContents } from '@shared/types';

/** Which view a worktree's expanded file area is showing. */
export type WorktreeFileView = 'all' | 'changed';

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
  openFileText: string | null;
  openFileTruncated: boolean;
  openFileBinary: boolean;
  openFileError: string | null;
  openFileLoading: boolean;

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

  /** Mark the panel open + loading for `path`; clears prior content/error. */
  startFileLoad: (path: string) => void;
  /** Apply a successful read result. Ignored if the user already switched files. */
  applyFileResult: (result: FileContents) => void;
  /** Record a read failure for `path`. Ignored if the user already switched. */
  setFileError: (path: string, error: string) => void;

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
  openFileText: null,
  openFileTruncated: false,
  openFileBinary: false,
  openFileError: null,
  openFileLoading: false,

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

  startFileLoad: (path) =>
    set({
      codePanelOpen: true,
      openFilePath: path,
      openFileText: null,
      openFileTruncated: false,
      openFileBinary: false,
      openFileError: null,
      openFileLoading: true,
    }),

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
