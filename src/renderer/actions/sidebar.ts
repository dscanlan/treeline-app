// Sidebar collapse orchestration shared by the titlebar toggle, the macOS
// menu accelerator (⌘B), and the empty-state escape hatch. Collapse state
// lives in the store *and* config.json, so every change must do both.
import { useStore } from '../store';

export function setSidebarCollapsed(next: boolean): void {
  useStore.getState().setSidebarCollapsed(next);
  void window.treeline.config.setSidebarCollapsed(next);
}

export function toggleSidebar(): void {
  setSidebarCollapsed(!useStore.getState().sidebarCollapsed);
}
