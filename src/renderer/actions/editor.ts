// Code-viewer orchestration: open a file in the side panel, lazily expand
// directories in the file tree, and drive the All|Changed view. Keeps the IPC
// dance out of the components, mirroring actions/tabs.ts.
import type { WorktreeFileView } from '../store/editor-slice';
import { useStore } from '../store';

/** Load a file into the code panel (opens the panel if it's closed). */
export async function openFileInPanel(path: string): Promise<void> {
  const s = useStore.getState();
  s.startFileLoad(path);
  try {
    const result = await window.treeline.files.read(path);
    useStore.getState().applyFileResult(result);
  } catch (err) {
    useStore.getState().setFileError(path, err instanceof Error ? err.message : String(err));
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
