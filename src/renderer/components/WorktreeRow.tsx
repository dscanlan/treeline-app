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
          title={treeOpen ? 'Hide files' : 'Browse files'}
          aria-label={treeOpen ? 'Hide files' : 'Browse files'}
          aria-expanded={treeOpen}
          className={`flex w-4 shrink-0 items-center justify-center hover:text-treeline-text ${
            treeOpen ? 'text-treeline-cyan' : 'text-treeline-dim'
          }`}
        >
          <FolderIcon open={treeOpen} />
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

/**
 * Folder glyph for the "browse files" toggle — deliberately not a chevron, so it
 * reads distinctly from the repo's expand/collapse triangle one level up.
 * Lucide-style stroked icons (folder / folder-open).
 */
function FolderIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {open ? (
        <path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />
      ) : (
        <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
      )}
    </svg>
  );
}
