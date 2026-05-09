import type { Tab } from '@shared/types';
import { useStore } from '../store';
import { closeTab } from '../actions/tabs';
import { TabStatusDot } from './TabStatusDot';

interface Props {
  tab: Tab;
}

export function TabItem({ tab }: Props) {
  const isActive = useStore((s) => s.activeTabId === tab.id);
  const setActive = useStore((s) => s.setActive);
  const setSelected = useStore((s) => s.setSelected);

  return (
    <div
      role="tab"
      aria-selected={isActive}
      onClick={() => {
        setActive(tab.id);
        setSelected(tab.cwd);
      }}
      className={`group flex h-7 cursor-pointer items-center gap-2 rounded-t border-x border-t px-2 text-xs ${
        isActive
          ? 'border-treeline-highlight bg-treeline-highlight text-treeline-text'
          : 'border-transparent text-treeline-dim hover:text-treeline-text'
      }`}
      title={tab.cwd}
    >
      <TabStatusDot status={tab.status} />
      <span className="max-w-[160px] truncate">{tab.title}</span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          void closeTab(tab.id);
        }}
        className="-mr-1 rounded px-1 text-treeline-dim opacity-0 hover:bg-treeline-surface hover:text-treeline-red group-hover:opacity-100"
        aria-label="Close tab"
      >
        ×
      </button>
    </div>
  );
}
