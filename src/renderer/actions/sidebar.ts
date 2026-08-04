// Sidebar collapse orchestration shared by the titlebar toggle, the macOS
// menu accelerator (⌘B), and the empty-state escape hatch. Collapse state
// lives in the store *and* config.json, so every change must do both.
import { useStore } from '../store';
import { toggleDir } from './editor';

export function setSidebarCollapsed(next: boolean): void {
  useStore.getState().setSidebarCollapsed(next);
  void window.treeline.config.setSidebarCollapsed(next);
}

export function toggleSidebar(): void {
  setSidebarCollapsed(!useStore.getState().sidebarCollapsed);
}

/** Replace the catalog with a single target's file tree and load its root. */
export async function openSidebarFiles(path: string): Promise<void> {
  const s = useStore.getState();
  s.setSelected(path);
  s.setSidebarFileRoot(path);
  if (!s.expandedDirs[path]) await toggleDir(path);
}
