// Sidebar collapse orchestration shared by the titlebar toggle, the macOS
// menu accelerator (⌘B), and the empty-state escape hatch. Collapse state
// lives in the store *and* config.json, so every change must do both.
import { useStore } from '../store';
import { refreshFileTree } from './editor';

export function setSidebarCollapsed(next: boolean): void {
  useStore.getState().setSidebarCollapsed(next);
  void window.treeline.config.setSidebarCollapsed(next);
}

export function toggleSidebar(): void {
  setSidebarCollapsed(!useStore.getState().sidebarCollapsed);
}

/**
 * Replace the catalog with a single target's file tree and (re-)load its root.
 * Every open re-reads, like expanding a directory does: the listing cache is
 * keyed by path and survives removing/re-adding a folder, so without this a
 * file created after the first open stays hidden. Cached children remain
 * rendered while the fresh read is in flight.
 */
export async function openSidebarFiles(path: string): Promise<void> {
  const s = useStore.getState();
  s.setSelected(path);
  s.setSidebarFileRoot(path);
  s.setDirExpanded(path, true);
  await refreshFileTree(path);
}
