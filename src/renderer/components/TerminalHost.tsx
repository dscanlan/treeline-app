import { leaves } from '@shared/pane-tree';
import { useStore } from '../store';
import { PaneTreeView } from './PaneTreeView';

export function TerminalHost() {
  const tabs = useStore((s) => s.tabs);
  const activeTabId = useStore((s) => s.activeTabId);

  if (tabs.length === 0) {
    return (
      <div className="flex min-w-0 flex-1 items-center justify-center text-treeline-dim">
        <div className="text-center">
          <p className="mb-1 text-treeline-cyan">no terminals open</p>
          <p>Click a worktree in the sidebar to open one.</p>
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
