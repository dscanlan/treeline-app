import { useStore } from '../store';
import type { Worktree } from '@shared/types';
import { basename } from '../util/path';
import { openTabAt } from '../actions/tabs';
import { toggleDir } from '../actions/editor';
import { TabStatusDot } from './TabStatusDot';
import { ProcessBadge } from './ProcessBadge';
import { PrBadge } from './PrBadge';
import { WorktreeFiles } from './WorktreeFiles';

interface Props {
  worktree: Worktree;
  /** Parent repo path; needed for the delete modal and refresh after remove. */
  repoPath: string;
}

export function WorktreeRow({ worktree, repoPath }: Props) {
  const selected = useStore((s) => s.selectedSidebarPath === worktree.path);
  const wtStatus = useStore((s) => s.worktreeStatus(worktree.path));
  const procs = useStore((s) => s.processesByWorktreePath[worktree.path] ?? []);
  const ports = useStore((s) => s.portsByWorktreePath[worktree.path] ?? []);
  // An agent in one of this worktree's terminals raised an unacknowledged
  // notification — surface a magenta unread dot next to the branch name.
  const hasUnread = useStore((s) => s.cwdHasUnread(worktree.path));
  const pr = useStore((s) => s.prByRepoBranch[repoPath]?.[worktree.branch]);
  const openModal = useStore((s) => s.openModal);
  const treeOpen = useStore((s) => !!s.expandedDirs[worktree.path]);

  const isClaude = worktree.isClaude;
  // A worktree whose branch is already merged into the default branch is dead
  // weight — grey the whole row and tag it so it reads as a prune candidate.
  const merged = worktree.merged;
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
        className={`flex flex-col gap-0.5 rounded px-2 py-1 ${
          selected ? 'bg-treeline-highlight' : 'hover:bg-treeline-highlight/60'
        } ${merged ? 'opacity-50' : ''}`}
      >
        {/* Top line: folder toggle, branch name (gets the full width), and the
          * hover-only delete affordance. */}
        <div className="flex items-center gap-2">
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
            {merged && (
              <span
                data-ss="worktree-merged-badge"
                title="Branch merged into the default branch — safe to prune"
                className="shrink-0 rounded border border-current px-1 py-px text-[10px] uppercase tracking-wide text-treeline-green"
              >
                merged
              </span>
            )}
            {hasUnread && (
              <span
                className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-treeline-magenta"
                title="An agent here needs your attention"
                aria-label="needs attention"
              />
            )}
          </button>
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
            className="shrink-0 rounded px-1 text-treeline-dim opacity-0 hover:bg-treeline-surface hover:text-treeline-red group-hover/wt:opacity-100"
          >
            ×
          </button>
        </div>
        {/* Second line: metadata, dim and indented under the branch name. */}
        <div className="flex items-center gap-1.5 pl-6 text-xs">
          {procs.map((p) => (
            <ProcessBadge key={p.pid} proc={p} />
          ))}
          {/* ── listening-port chips (feature #4) ──────────────────────────
            * Self-contained region: renders `:3000 :5173` for ports owned by
            * processes rooted in this worktree. FUTURE BADGE OWNER (#5 PR
            * status / #6 notifications): add your badge before or after this
            * block on the same metadata line — do NOT refactor the layout. */}
          <PortChips ports={ports} />
          {/* ── end listening-port chips ─────────────────────────────────── */}
          {/* Linked PR badge (feature #5): #NNN + state color + CI glyph, opens
            * the PR on GitHub. Self-contained, sibling to the port chips. */}
          {pr && <PrBadge pr={pr} />}
          {worktree.isDirty && (
            <span className="text-treeline-yellow" title="dirty">
              ●
            </span>
          )}
          <span className="text-treeline-dim">{worktree.commit}</span>
          {wtStatus && <TabStatusDot status={wtStatus} />}
        </div>
      </div>
      {treeOpen && <WorktreeFiles worktreePath={worktree.path} />}
    </li>
  );
}

/**
 * Listening-port chips for a worktree's second metadata line. One `:PORT` chip
 * per port that a process rooted in this worktree is listening on; clicking a
 * chip opens the embedded browser pane at `http://localhost:<port>` (the same
 * store action the scriptable `treeline browser navigate` verb drives). Renders
 * nothing when the worktree owns no listening ports. Kept self-contained so the
 * row layout stays untouched as later features add sibling badges.
 */
function PortChips({ ports }: { ports: number[] }) {
  const openBrowserPanel = useStore((s) => s.openBrowserPanel);
  if (ports.length === 0) return null;
  return (
    <span className="flex items-center gap-1" data-ss="worktree-ports">
      {ports.map((port) => (
        <button
          key={port}
          type="button"
          onClick={() => openBrowserPanel(`http://localhost:${port}`)}
          title={`Open localhost:${port} in the browser pane`}
          className="rounded border border-treeline-cyan/50 px-1 py-px text-[10px] text-treeline-cyan hover:bg-treeline-cyan/15 hover:text-treeline-text"
        >
          :{port}
        </button>
      ))}
    </span>
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
