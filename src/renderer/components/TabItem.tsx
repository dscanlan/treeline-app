import type { Tab } from '@shared/types';
import type { TabStatus } from '@shared/types';
import { leaves } from '@shared/pane-tree';
import { useStore } from '../store';
import { closeTab, openDriftedWorktree } from '../actions/tabs';
import { TabStatusDot } from './TabStatusDot';

/** Aggregate a tab's pane statuses for its strip dot: running → idle → exited. */
function aggregateStatus(tab: Tab): TabStatus {
  const statuses = leaves(tab.root).map((l) => l.status);
  if (statuses.includes('running')) return 'running';
  if (statuses.includes('idle')) return 'idle';
  return 'exited';
}

interface Props {
  tab: Tab;
  /** Start a drag-to-reorder gesture from this tab. */
  onDragStart: (id: string, e: React.PointerEvent) => void;
  /** True while this tab is the one being dragged. */
  isDragging: boolean;
  /** Returns true if the last pointer interaction turned into a real drag, so
   * the trailing click should be suppressed (not treated as activation). */
  didDrag: () => boolean;
}

export function TabItem({ tab, onDragStart, isDragging, didDrag }: Props) {
  const isActive = useStore((s) => s.activeTabId === tab.id);
  const setActive = useStore((s) => s.setActive);
  const setSelected = useStore((s) => s.setSelected);
  const setSelectedScratch = useStore((s) => s.setSelectedScratch);
  // A scratch tab's id matches a Scratch.id (both are the ptyId). When the
  // user activates it, highlight the matching scratch row in the sidebar
  // instead of a (non-existent) worktree row at the cwd.
  const isScratch = useStore((s) => s.scratches.some((sc) => sc.id === tab.id));
  // A drift exists when one of this tab's panes cd'd into a different worktree.
  // Show a chip linking to that worktree (the first one, if several panes drift).
  const drift = useStore((s) => {
    const paneIds = new Set(leaves(tab.root).map((l) => l.ptyId));
    for (const d of Object.values(s.driftByWorktree)) {
      if (d.ptyId && paneIds.has(d.ptyId)) return d;
    }
    return null;
  });
  const driftBasename = drift
    ? (drift.toWorktree.split('/').filter(Boolean).pop() ?? drift.toWorktree)
    : null;

  return (
    <div
      role="tab"
      aria-selected={isActive}
      onPointerDown={(e) => onDragStart(tab.id, e)}
      onClick={() => {
        if (didDrag()) return;
        setActive(tab.id);
        if (isScratch) setSelectedScratch(tab.id);
        else setSelected(tab.cwd);
      }}
      className={`group flex h-7 cursor-pointer items-center gap-2 rounded-t border-x border-t px-2 text-xs ${
        isActive
          ? 'border-treeline-highlight bg-treeline-highlight text-treeline-text'
          : 'border-transparent text-treeline-dim hover:text-treeline-text'
      } ${
        isDragging
          ? 'z-10 bg-treeline-cyan/20 text-treeline-text shadow-lg ring-1 ring-treeline-cyan'
          : ''
      }`}
      title={tab.cwd}
    >
      <TabStatusDot status={aggregateStatus(tab)} />
      <span className="max-w-[160px] truncate">{tab.title}</span>
      {drift && (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            void openDriftedWorktree(drift.toWorktree);
          }}
          title={`Open a terminal in ${drift.toWorktree}`}
          className="max-w-[120px] truncate rounded bg-treeline-cyan/15 px-1 text-treeline-cyan hover:bg-treeline-cyan/25"
        >
          ↗ {driftBasename}
        </button>
      )}
      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
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
