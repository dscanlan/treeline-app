import { useStore } from '../store';
import { TerminalView } from './TerminalView';

export function TerminalHost() {
  const tabs = useStore((s) => s.tabs);
  const activeTabId = useStore((s) => s.activeTabId);

  if (tabs.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-treeline-dim">
        <div className="text-center">
          <p className="mb-1 text-treeline-cyan">no terminals open</p>
          <p>Click a worktree in the sidebar to open one.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex-1 bg-treeline-surface">
      {tabs.map((tab) => (
        <TerminalView
          key={tab.id}
          ptyId={tab.ptyId}
          cwd={tab.cwd}
          active={tab.id === activeTabId}
        />
      ))}
    </div>
  );
}
