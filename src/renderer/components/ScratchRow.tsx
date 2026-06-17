import { useStore } from '../store';
import type { Scratch } from '../store/scratch-slice';
import { leaves } from '@shared/pane-tree';
import { closeTab } from '../actions/tabs';
import { TabStatusDot } from './TabStatusDot';

interface Props {
  scratch: Scratch;
}

/**
 * A row in the sidebar's scratch-terminals section. Visually similar to a
 * WorktreeRow but with no commit / dirty / process metadata — a scratch is
 * just "a shell that exists at this id".
 */
export function ScratchRow({ scratch }: Props) {
  const selected = useStore((s) => s.selectedScratchId === scratch.id);
  const setSelectedScratch = useStore((s) => s.setSelectedScratch);
  const setActive = useStore((s) => s.setActive);
  // Pull the live status off the scratch tab's pane(s) so the same green/cyan/
  // dim status dot RepoNode → WorktreeRow uses also fires for scratches. A
  // scratch tab is single-pane today; read its leaf's status.
  const status = useStore((s) => {
    const tab = s.tabs.find((t) => t.id === scratch.id);
    return tab ? leaves(tab.root)[0]?.status ?? null : null;
  });

  return (
    <li className="group/sc" data-ss="scratch-row" data-ss-id={scratch.id}>
      <div
        className={`flex w-full items-center gap-2 rounded px-2 py-1 ${
          selected ? 'bg-treeline-highlight' : 'hover:bg-treeline-highlight/60'
        }`}
      >
        <button
          type="button"
          onClick={() => {
            setSelectedScratch(scratch.id);
            setActive(scratch.ptyId);
          }}
          title={`Scratch terminal — started in ${scratch.cwd}`}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span className="shrink-0 font-mono text-[11px] text-treeline-cyan">&gt;_</span>
          <span className="truncate text-treeline-text">{scratch.label}</span>
        </button>
        <div className="flex shrink-0 items-center gap-1.5 text-xs">
          {status && <TabStatusDot status={status} />}
          <button
            type="button"
            onClick={() => void closeTab(scratch.ptyId)}
            title="Close scratch terminal"
            aria-label="Close scratch terminal"
            className="rounded px-1 text-treeline-dim opacity-0 hover:bg-treeline-surface hover:text-treeline-red group-hover/sc:opacity-100"
          >
            ×
          </button>
        </div>
      </div>
    </li>
  );
}
