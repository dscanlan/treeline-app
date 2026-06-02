import type { StateCreator } from 'zustand';
import type { DirEntry, FileContents } from '@shared/types';

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
});
