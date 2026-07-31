import { leaves } from '@shared/pane-tree';
import { toggleSidebar } from '../actions/sidebar';
import { useStore } from '../store';
import { PaneTreeView } from './PaneTreeView';

export function TerminalHost() {
  const tabs = useStore((s) => s.tabs);
  const activeTabId = useStore((s) => s.activeTabId);
  const sidebarCollapsed = useStore((s) => s.sidebarCollapsed);

  if (tabs.length === 0) {
    // With the sidebar collapsed the window is otherwise empty, so the usual
    // "click a worktree" copy would point at an invisible element — offer a
    // way to bring the sidebar back instead.
    return (
      <div className="flex min-w-0 flex-1 items-center justify-center text-treeline-dim">
        <div className="text-center">
          <p className="mb-1 text-treeline-cyan">no terminals open</p>
          {sidebarCollapsed ? (
            <>
              <p className="mb-3">Your repos and worktrees are in the sidebar, which is hidden.</p>
              <button
                type="button"
                onClick={toggleSidebar}
                data-ss="empty-state-show-sidebar"
                className="rounded border border-treeline-highlight px-3 py-1 text-xs text-treeline-text hover:bg-treeline-highlight"
              >
                Show sidebar (⌘B)
              </button>
            </>
          ) : (
            <p>Click a worktree in the sidebar to open one.</p>
          )}
        </div>
      </div>
    );
  }

  // Every tab stays mounted (visibility-hidden when inactive) so each pane's
  // xterm keeps consuming PTY data — the "hidden tabs stay mounted" rule, now
  // per leaf. Only the active tab is visible and interactive.
  return (
    <div className="relative min-w-0 flex-1 bg-treeline-surface">
      {tabs.map((tab) => {
        const active = tab.id === activeTabId;
        const multiPane = leaves(tab.root).length > 1;
        return (
          <div
            key={tab.id}
            className="absolute inset-0"
            style={{
              visibility: active ? 'visible' : 'hidden',
              pointerEvents: active ? 'auto' : 'none',
            }}
          >
            <PaneTreeView
              node={tab.root}
              tabId={tab.id}
              focusedPaneId={tab.focusedPaneId}
              tabActive={active}
              multiPane={multiPane}
            />
          </div>
        );
      })}
    </div>
  );
}
