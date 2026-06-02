import { useStore } from '../store';
import type { Worktree } from '@shared/types';
import { basename } from '../util/path';
import { openTabAt } from '../actions/tabs';
import { toggleDir } from '../actions/editor';
import { TabStatusDot } from './TabStatusDot';
import { ProcessBadge } from './ProcessBadge';
import { FileTree } from './FileTree';

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
  const treeOpen = useStore((s) => !!s.expandedDirs[worktree.path]);

  const isClaude = worktree.isClaude;
  const labelColor = isClaude ? 'text-treeline-magenta' : 'text-treeline-text';
  const icon = isClaude ? '✦' : worktree.isCurrent ? '●' : '○';
  const iconColor = isClaude
    ? 'text-treeline-magenta'
    : worktree.isCurrent
      ? 'text-treeline-green'
      : 'text-treeline-cyan';

  return (
    <li className="group/wt" data-ss="worktree-row" data-ss-path={worktree.path}>
      <div
        className={`flex w-full items-center gap-2 rounded px-2 py-1 ${
          selected ? 'bg-treeline-highlight' : 'hover:bg-treeline-highlight/60'
        }`}
      >
        <button
          type="button"
          onClick={() => void toggleDir(worktree.path)}
          title={treeOpen ? 'Hide files' : 'Show files'}
          aria-label={treeOpen ? 'Hide files' : 'Show files'}
          aria-expanded={treeOpen}
          className="w-3 shrink-0 text-center text-[10px] text-treeline-dim hover:text-treeline-text"
        >
          {treeOpen ? '▾' : '▸'}
        </button>
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
      {treeOpen && <FileTree dirPath={worktree.path} depth={0} />}
    </li>
  );
}
