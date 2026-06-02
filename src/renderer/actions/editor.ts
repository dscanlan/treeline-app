// Code-viewer orchestration: open a file in the side panel, lazily expand
// directories in the file tree, and drive the All|Changed view. Keeps the IPC
// dance out of the components, mirroring actions/tabs.ts.
import type { PanelMode, WorktreeFileView } from '../store/editor-slice';
import { useStore } from '../store';

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Fetch the full-file representation for `path` into the panel. */
async function loadFileContent(path: string): Promise<void> {
  useStore.getState().setFileLoading(true);
  try {
    const result = await window.treeline.files.read(path);
    useStore.getState().applyFileResult(result);
  } catch (err) {
    useStore.getState().setFileError(path, errMsg(err));
  }
}

/** Fetch the diff representation for `path` into the panel. */
async function loadFileDiff(path: string): Promise<void> {
  useStore.getState().setDiffLoading(true);
  try {
    const diff = await window.treeline.files.diff(path);
    useStore.getState().applyDiffResult(diff);
  } catch (err) {
    useStore.getState().setDiffError(path, errMsg(err));
  }
}

/** Open a file in the panel showing its full contents (used by the tree). */
export async function openFileInPanel(path: string): Promise<void> {
  useStore.getState().openInPanel(path, 'file');
  await loadFileContent(path);
}

/** Open a file in the panel showing its diff (used by the Changed list). */
export async function openDiffInPanel(path: string): Promise<void> {
  useStore.getState().openInPanel(path, 'diff');
  await loadFileDiff(path);
}

/**
 * Flip the open file between File and Diff in the panel header, lazily fetching
 * the other representation the first time it's needed.
 */
export function setPanelMode(mode: PanelMode): void {
  const s = useStore.getState();
  const path = s.openFilePath;
  if (!path) return;
  s.setPanelMode(mode);
  if (mode === 'file' && s.openFileText === null && s.openFileError === null && !s.openFileLoading) {
    void loadFileContent(path);
  }
  if (mode === 'diff' && s.openDiff === null && s.diffError === null && !s.diffLoading) {
    void loadFileDiff(path);
  }
}

/**
 * Toggle a directory node in the tree. On first expand we fetch its children
 * and cache them; subsequent toggles just flip the expanded flag.
 */
export async function toggleDir(path: string): Promise<void> {
  const s = useStore.getState();
  const willExpand = !s.expandedDirs[path];
  s.setDirExpanded(path, willExpand);
  if (willExpand && s.dirChildren[path] === undefined) {
    try {
      const entries = await window.treeline.files.readDir(path);
      useStore.getState().setDirChildren(path, entries);
    } catch {
      // Leave children undefined; the row shows nothing rather than crashing.
      useStore.getState().setDirChildren(path, []);
    }
  }
}

/** Fetch (or re-fetch) a worktree's working-tree changes into the store. */
export async function refreshChangedFiles(worktreePath: string): Promise<void> {
  const s = useStore.getState();
  // Only show the spinner on a cold load; background refreshes stay silent.
  if (s.changedByWorktree[worktreePath] === undefined) {
    s.setChangedLoading(worktreePath, true);
  }
  try {
    const files = await window.treeline.files.changed(worktreePath);
    useStore.getState().setChangedFiles(worktreePath, files);
  } catch {
    useStore.getState().setChangedFiles(worktreePath, []);
  }
}

/**
 * Switch a worktree's file area between All and Changed. Entering Changed
 * fetches the list (cached results show immediately, then refresh).
 */
export function setWorktreeFileView(worktreePath: string, view: WorktreeFileView): void {
  useStore.getState().setWorktreeFileView(worktreePath, view);
  if (view === 'changed') void refreshChangedFiles(worktreePath);
}
