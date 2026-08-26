import type { StateCreator } from 'zustand';
import type { ChangedFile, DirEntry, FileContents, FileDiff } from '@shared/types';
import { sanitizePinnedFilePaths, togglePinnedFilePath } from '@shared/file-pins';

const FILE_PINS_STORAGE_KEY = 'treeline.pinnedFilePaths';
interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function rendererStorage(): StorageLike | undefined {
  try {
    return (globalThis as typeof globalThis & { localStorage?: StorageLike }).localStorage;
  } catch {
    // Access itself can throw for a restricted/opaque renderer origin.
    return undefined;
  }
}

function loadPersistedFilePins(): string[] {
  const storage = rendererStorage();
  if (!storage) return [];
  try {
    return sanitizePinnedFilePaths(JSON.parse(storage.getItem(FILE_PINS_STORAGE_KEY) ?? '[]'));
  } catch {
    return [];
  }
}

function persistFilePins(paths: string[]): void {
  const storage = rendererStorage();
  if (!storage) return;
  try {
    storage.setItem(FILE_PINS_STORAGE_KEY, JSON.stringify(paths));
  } catch {
    // Best-effort renderer preference, matching the other sidebar pins.
  }
}

/** Which view a worktree's expanded file area is showing. */
export type WorktreeFileView = 'all' | 'changed';

/** The representation shown for one open document. */
export type PanelMode = 'file' | 'diff' | 'preview';

export type ViewerPaneId = 'primary' | 'secondary';
export type ViewerSplitDirection = 'rows' | 'columns';

export interface ViewerPane {
  id: ViewerPaneId;
  path: string;
}

/** All viewer/edit state owned by one file tab. */
export interface OpenFileState {
  path: string;
  panelMode: PanelMode;
  revealLine: number | null;
  revealTick: number;

  fileText: string | null;
  fileTruncated: boolean;
  fileBinary: boolean;
  fileError: string | null;
  fileLoading: boolean;
  fileRequestId: number;

  diff: FileDiff | null;
  diffError: string | null;
  diffLoading: boolean;
  diffRequestId: number;

  editing: boolean;
  draft: string | null;
  saving: boolean;
  saveError: string | null;
}

export function createOpenFileState(path: string, panelMode: PanelMode): OpenFileState {
  return {
    path,
    panelMode,
    revealLine: null,
    revealTick: 0,
    fileText: null,
    fileTruncated: false,
    fileBinary: false,
    fileError: null,
    fileLoading: false,
    fileRequestId: 0,
    diff: null,
    diffError: null,
    diffLoading: false,
    diffRequestId: 0,
    editing: false,
    draft: null,
    saving: false,
    saveError: null,
  };
}

/** Clamp bounds for the resizable code panel (px). */
export const CODE_PANEL_MIN_WIDTH = 280;
/**
 * Absolute ceiling, kept deliberately high: the real limit is the responsive
 * one below. A fixed pixel cap here used to be the binding constraint on large
 * displays — on a 4K window the panel stopped at 1000px (~26% of the window)
 * however far you dragged.
 */
export const CODE_PANEL_MAX_WIDTH = 10000;
export const CODE_PANEL_DEFAULT_WIDTH = 480;

/** The panel may take at most this share of the space available to it. */
export const CODE_PANEL_MAX_FRACTION = 0.9;

/**
 * Clamp a dragged code-panel width against the space actually available to it.
 *
 * `available` is the width the panel could occupy at most — the workspace row
 * minus any other panels sharing it (browser/scratchpad/search), so the 90%
 * ceiling is measured against real free space rather than the whole row.
 *
 * The floor wins on very narrow windows: below ~311px of available space,
 * CODE_PANEL_MIN_WIDTH exceeds 90% of it and MainArea's `max-width: 90%`
 * backstop clips the render instead.
 */
export function clampCodePanelWidth(desired: number, available: number): number {
  const ceiling = Math.min(CODE_PANEL_MAX_WIDTH, available * CODE_PANEL_MAX_FRACTION);
  return Math.max(CODE_PANEL_MIN_WIDTH, Math.min(ceiling, desired));
}

export interface EditorSlice {
  codePanelOpen: boolean;
  codePanelWidth: number;

  /** File-tab order and the currently visible tab. Paths are unique tab ids. */
  openFilePaths: string[];
  activeFilePath: string | null;
  openFilesByPath: Record<string, OpenFileState>;
  /** One or two simultaneous viewers; activeFilePath mirrors the focused pane. */
  viewerPanes: ViewerPane[];
  focusedViewerPaneId: ViewerPaneId;
  viewerSplitDirection: ViewerSplitDirection;
  viewerSplitRatio: number;

  expandedDirs: Record<string, boolean>;
  dirChildren: Record<string, DirEntry[]>;
  worktreeFileView: Record<string, WorktreeFileView>;
  changedByWorktree: Record<string, ChangedFile[]>;
  changedLoading: Record<string, boolean>;

  pinnedFilePaths: string[];
  missingPinnedFiles: Record<string, boolean>;

  setCodePanelWidth: (w: number) => void;
  /** Hide the panel without discarding its tabs or drafts. */
  closeCodePanel: () => void;
  openInPanel: (path: string, mode: PanelMode, paneId?: ViewerPaneId) => void;
  activateOpenFile: (path: string) => void;
  openFileInSplit: (path: string) => void;
  focusViewerPane: (paneId: ViewerPaneId) => void;
  closeViewerPane: (paneId: ViewerPaneId) => void;
  setViewerSplitDirection: (direction: ViewerSplitDirection) => void;
  setViewerSplitRatio: (ratio: number) => void;
  closeOpenFile: (path: string) => void;
  setPanelMode: (path: string, mode: PanelMode) => void;
  setRevealLine: (path: string, line: number | null) => void;

  beginFileLoad: (path: string) => number;
  applyFileResult: (result: FileContents, requestId: number) => void;
  setFileError: (path: string, requestId: number, error: string) => void;
  beginDiffLoad: (path: string) => number;
  applyDiffResult: (diff: FileDiff, requestId: number) => void;
  setDiffError: (path: string, requestId: number, error: string) => void;

  setDirChildren: (path: string, entries: DirEntry[]) => void;
  setDirExpanded: (path: string, expanded: boolean) => void;

  startEditing: (path: string) => void;
  setDraft: (path: string, text: string) => void;
  stopEditing: (path: string) => void;
  setSaving: (path: string, saving: boolean) => void;
  applySaved: (path: string, content: string) => void;
  setSaveError: (path: string, error: string) => void;

  setWorktreeFileView: (worktreePath: string, view: WorktreeFileView) => void;
  setChangedLoading: (worktreePath: string, loading: boolean) => void;
  setChangedFiles: (worktreePath: string, files: ChangedFile[]) => void;
  togglePinnedFile: (path: string) => void;
  setPinnedFileMissing: (path: string, missing: boolean) => void;
}

function patchOpenFile(
  state: EditorSlice,
  path: string,
  patch: Partial<OpenFileState>,
): Pick<EditorSlice, 'openFilesByPath'> | EditorSlice {
  const current = state.openFilesByPath[path];
  if (!current) return state;
  return {
    openFilesByPath: {
      ...state.openFilesByPath,
      [path]: { ...current, ...patch },
    },
  };
}

export const createEditorSlice: StateCreator<EditorSlice, [], [], EditorSlice> = (set) => ({
  codePanelOpen: false,
  codePanelWidth: CODE_PANEL_DEFAULT_WIDTH,
  openFilePaths: [],
  activeFilePath: null,
  openFilesByPath: {},
  viewerPanes: [],
  focusedViewerPaneId: 'primary',
  viewerSplitDirection: 'rows',
  viewerSplitRatio: 50,

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

  openInPanel: (path, mode, paneId) =>
    set((s) => {
      const existing = s.openFilesByPath[path];
      const file = existing
        ? { ...existing, panelMode: mode, revealLine: null }
        : createOpenFileState(path, mode);
      const alreadyVisible = s.viewerPanes.find((pane) => pane.path === path);
      const targetId = paneId ?? s.focusedViewerPaneId;
      let viewerPanes: ViewerPane[];
      let focusedViewerPaneId: ViewerPaneId;
      if (alreadyVisible) {
        viewerPanes = s.viewerPanes;
        focusedViewerPaneId = alreadyVisible.id;
      } else if (s.viewerPanes.length === 0) {
        viewerPanes = [{ id: 'primary', path }];
        focusedViewerPaneId = 'primary';
      } else if (
        targetId === 'secondary' &&
        !s.viewerPanes.some((pane) => pane.id === 'secondary')
      ) {
        viewerPanes = [...s.viewerPanes, { id: 'secondary', path }];
        focusedViewerPaneId = 'secondary';
      } else {
        const target = s.viewerPanes.some((pane) => pane.id === targetId) ? targetId : 'primary';
        viewerPanes = s.viewerPanes.map((pane) => (pane.id === target ? { ...pane, path } : pane));
        focusedViewerPaneId = target;
      }
      return {
        codePanelOpen: true,
        activeFilePath: path,
        focusedViewerPaneId,
        viewerPanes,
        openFilePaths: existing ? s.openFilePaths : [...s.openFilePaths, path],
        openFilesByPath: { ...s.openFilesByPath, [path]: file },
      };
    }),

  activateOpenFile: (path) =>
    set((s) => {
      if (!s.openFilesByPath[path]) return s;
      const alreadyVisible = s.viewerPanes.find((pane) => pane.path === path);
      if (alreadyVisible) {
        return {
          codePanelOpen: true,
          activeFilePath: path,
          focusedViewerPaneId: alreadyVisible.id,
        };
      }
      const target = s.viewerPanes.find((pane) => pane.id === s.focusedViewerPaneId);
      const viewerPanes: ViewerPane[] = target
        ? s.viewerPanes.map((pane) => (pane.id === target.id ? { ...pane, path } : pane))
        : [{ id: 'primary', path }];
      return {
        codePanelOpen: true,
        activeFilePath: path,
        focusedViewerPaneId: target?.id ?? 'primary',
        viewerPanes,
      };
    }),

  openFileInSplit: (path) =>
    set((s) => {
      if (!s.openFilesByPath[path]) return s;
      const alreadyVisible = s.viewerPanes.find((pane) => pane.path === path);
      if (alreadyVisible) {
        return {
          codePanelOpen: true,
          activeFilePath: path,
          focusedViewerPaneId: alreadyVisible.id,
        };
      }
      if (s.viewerPanes.length === 0) {
        return {
          codePanelOpen: true,
          activeFilePath: path,
          focusedViewerPaneId: 'primary',
          viewerPanes: [{ id: 'primary', path }],
        };
      }
      if (s.viewerPanes.length === 1) {
        return {
          codePanelOpen: true,
          activeFilePath: path,
          focusedViewerPaneId: 'secondary',
          viewerPanes: [...s.viewerPanes, { id: 'secondary', path }],
        };
      }
      const otherId: ViewerPaneId = s.focusedViewerPaneId === 'primary' ? 'secondary' : 'primary';
      return {
        codePanelOpen: true,
        activeFilePath: path,
        focusedViewerPaneId: otherId,
        viewerPanes: s.viewerPanes.map((pane) => (pane.id === otherId ? { ...pane, path } : pane)),
      };
    }),

  focusViewerPane: (paneId) =>
    set((s) => {
      const pane = s.viewerPanes.find((candidate) => candidate.id === paneId);
      return pane ? { focusedViewerPaneId: paneId, activeFilePath: pane.path } : s;
    }),

  closeViewerPane: (paneId) =>
    set((s) => {
      if (s.viewerPanes.length < 2 || !s.viewerPanes.some((pane) => pane.id === paneId)) return s;
      const remaining = s.viewerPanes.find((pane) => pane.id !== paneId)!;
      return {
        viewerPanes: [{ id: 'primary', path: remaining.path }],
        focusedViewerPaneId: 'primary',
        activeFilePath: remaining.path,
      };
    }),

  setViewerSplitDirection: (viewerSplitDirection) => set({ viewerSplitDirection }),
  setViewerSplitRatio: (ratio) => set({ viewerSplitRatio: Math.max(20, Math.min(80, ratio)) }),

  closeOpenFile: (path) =>
    set((s) => {
      const index = s.openFilePaths.indexOf(path);
      if (index === -1) return s;
      const openFilePaths = s.openFilePaths.filter((p) => p !== path);
      const openFilesByPath = { ...s.openFilesByPath };
      delete openFilesByPath[path];
      const wasVisible = s.viewerPanes.some((pane) => pane.path === path);
      let viewerPanes = s.viewerPanes.filter((pane) => pane.path !== path);
      if (viewerPanes.length === 1) {
        viewerPanes = [{ id: 'primary', path: viewerPanes[0].path }];
      } else if (viewerPanes.length === 0 && openFilePaths.length > 0) {
        const replacement = openFilePaths[Math.min(index, openFilePaths.length - 1)];
        viewerPanes = [{ id: 'primary', path: replacement }];
      }
      const activeFilePath = wasVisible ? (viewerPanes[0]?.path ?? null) : s.activeFilePath;
      return {
        openFilePaths,
        openFilesByPath,
        activeFilePath,
        viewerPanes,
        focusedViewerPaneId: wasVisible ? 'primary' : s.focusedViewerPaneId,
        codePanelOpen: openFilePaths.length > 0 && s.codePanelOpen,
      };
    }),

  setPanelMode: (path, mode) => set((s) => patchOpenFile(s, path, { panelMode: mode })),

  setRevealLine: (path, line) =>
    set((s) => {
      const file = s.openFilesByPath[path];
      return file
        ? patchOpenFile(s, path, { revealLine: line, revealTick: file.revealTick + 1 })
        : s;
    }),

  beginFileLoad: (path) => {
    let requestId = 0;
    set((s) => {
      const file = s.openFilesByPath[path];
      if (!file) return s;
      requestId = file.fileRequestId + 1;
      return patchOpenFile(s, path, {
        fileRequestId: requestId,
        fileLoading: true,
        fileError: null,
      });
    });
    return requestId;
  },

  applyFileResult: (result, requestId) =>
    set((s) => {
      const file = s.openFilesByPath[result.path];
      if (!file || file.fileRequestId !== requestId) return s;
      return patchOpenFile(s, result.path, {
        fileText: result.text,
        fileTruncated: result.truncated,
        fileBinary: result.binary,
        fileError: null,
        fileLoading: false,
      });
    }),

  setFileError: (path, requestId, error) =>
    set((s) => {
      const file = s.openFilesByPath[path];
      return !file || file.fileRequestId !== requestId
        ? s
        : patchOpenFile(s, path, { fileError: error, fileLoading: false });
    }),

  beginDiffLoad: (path) => {
    let requestId = 0;
    set((s) => {
      const file = s.openFilesByPath[path];
      if (!file) return s;
      requestId = file.diffRequestId + 1;
      return patchOpenFile(s, path, {
        diffRequestId: requestId,
        diffLoading: true,
        diffError: null,
      });
    });
    return requestId;
  },

  applyDiffResult: (diff, requestId) =>
    set((s) => {
      const file = s.openFilesByPath[diff.path];
      if (!file || file.diffRequestId !== requestId) return s;
      return patchOpenFile(s, diff.path, { diff, diffError: null, diffLoading: false });
    }),

  setDiffError: (path, requestId, error) =>
    set((s) => {
      const file = s.openFilesByPath[path];
      return !file || file.diffRequestId !== requestId
        ? s
        : patchOpenFile(s, path, { diffError: error, diffLoading: false });
    }),

  setDirChildren: (path, entries) =>
    set((s) => ({ dirChildren: { ...s.dirChildren, [path]: entries } })),

  setDirExpanded: (path, expanded) =>
    set((s) => ({ expandedDirs: { ...s.expandedDirs, [path]: expanded } })),

  startEditing: (path) =>
    set((s) => {
      const file = s.openFilesByPath[path];
      return file
        ? patchOpenFile(s, path, { editing: true, draft: file.fileText ?? '', saveError: null })
        : s;
    }),

  setDraft: (path, text) => set((s) => patchOpenFile(s, path, { draft: text })),

  stopEditing: (path) =>
    set((s) =>
      patchOpenFile(s, path, { editing: false, draft: null, saving: false, saveError: null }),
    ),

  setSaving: (path, saving) => set((s) => patchOpenFile(s, path, { saving })),

  applySaved: (path, content) =>
    set((s) => {
      if (!s.openFilesByPath[path]) return s;
      // Keep a newer draft typed during the write; it remains dirty against the new baseline.
      return patchOpenFile(s, path, { fileText: content, saving: false, saveError: null });
    }),

  setSaveError: (path, error) =>
    set((s) => patchOpenFile(s, path, { saveError: error, saving: false })),

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
