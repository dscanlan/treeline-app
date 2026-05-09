import { useStore } from '../store';
import type { Worktree } from '@shared/types';
import { basename } from '../util/path';
import { openTabAt } from '../actions/tabs';
import { TabStatusDot } from './TabStatusDot';
import { ProcessBadge } from './ProcessBadge';

interface Props {
  worktree: Worktree;
  /** Parent repo path; needed for the delete modal and refresh after remove. */
  repoPath: string;
}

export function WorktreeRow({ worktree, repoPath }: Props) {
  const selected = useStore((s) => s.selectedSidebarPath === worktree.path);
  const wtStatus = useStore((s) => s.worktreeStatus(worktree.path));
  const procs = useStore((s) => s.processesByWorktreePath[worktree.path] ?? []);
  const openModal = useStore((s) => s.openModal);

  const isClaude = worktree.isClaude;
  const labelColor = isClaude ? 'text-treeline-magenta' : 'text-treeline-text';
  const icon = isClaude ? '✦' : worktree.isCurrent ? '●' : '○';
  const iconColor = isClaude
    ? 'text-treeline-magenta'
    : worktree.isCurrent
      ? 'text-treeline-green'
      : 'text-treeline-cyan';

  return (
    <li className="group/wt">
      <div
        className={`flex w-full items-center gap-2 rounded px-2 py-1 ${
          selected ? 'bg-treeline-highlight' : 'hover:bg-treeline-highlight/60'
        }`}
      >
        <button
          type="button"
          onClick={() => void openTabAt(worktree.path)}
          title={worktree.path}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span className={`shrink-0 ${iconColor}`}>{icon}</span>
          <span className={`truncate ${labelColor}`}>
            {worktree.branch || basename(worktree.path)}
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-1.5 text-xs">
          {procs.map((p) => (
            <ProcessBadge key={p.pid} proc={p} />
          ))}
          {worktree.isDirty && (
            <span className="text-treeline-yellow" title="dirty">
              ●
            </span>
          )}
          <span className="text-treeline-dim">{worktree.commit}</span>
          {wtStatus && <TabStatusDot status={wtStatus} />}
          <button
            type="button"
            onClick={() =>
              openModal({
                kind: 'delete-worktree',
                repoPath,
                worktreePath: worktree.path,
                branch: worktree.branch,
              })
            }
            title="Delete worktree"
            className="rounded px-1 text-treeline-dim opacity-0 hover:bg-treeline-surface hover:text-treeline-red group-hover/wt:opacity-100"
          >
            ×
          </button>
        </div>
      </div>
    </li>
  );
}
