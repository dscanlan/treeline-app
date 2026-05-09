import { useStore } from '../store';
import { TabItem } from './TabItem';
import { openTabAt } from '../actions/tabs';

export function TabBar() {
  const tabs = useStore((s) => s.tabs);
  const selectedSidebarPath = useStore((s) => s.selectedSidebarPath);

  const onPlus = async () => {
    if (!selectedSidebarPath) return;
    await openTabAt(selectedSidebarPath, { forceNew: true });
  };

  if (tabs.length === 0 && !selectedSidebarPath) return null;

  return (
    <div className="flex h-9 shrink-0 items-end gap-px overflow-x-auto border-b border-treeline-highlight bg-treeline-surface px-2">
      {tabs.map((tab) => (
        <TabItem key={tab.id} tab={tab} />
      ))}
      <button
        type="button"
        onClick={onPlus}
        disabled={!selectedSidebarPath}
        title={
          selectedSidebarPath
            ? `New tab on ${selectedSidebarPath}`
            : 'Select a worktree first'
        }
        className="ml-1 rounded px-2 py-1 text-treeline-dim hover:bg-treeline-highlight hover:text-treeline-text disabled:cursor-not-allowed disabled:opacity-40"
      >
        +
      </button>
    </div>
  );
}
