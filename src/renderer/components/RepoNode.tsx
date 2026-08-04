import { useState } from 'react';
import { AGENTS } from '@shared/agents';
import type { Repo } from '@shared/types';
import { useStore } from '../store';
import { WorktreeRow } from './WorktreeRow';
import { openTabAt } from '../actions/tabs';

interface Props {
  repo: Repo;
  worktrees: ReturnType<typeof useStore.getState>['worktreesByRepo'][string];
  defaultOpen?: boolean;
  forceOpen?: boolean;
  totalWorktrees: number;
  activeWorktrees: number;
  dirtyWorktrees: number;
}

export function RepoNode({
  repo,
  worktrees,
  defaultOpen = false,
  forceOpen = false,
  totalWorktrees,
  activeWorktrees,
  dirtyWorktrees,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const openModal = useStore((s) => s.openModal);
  const setRepos = useStore((s) => s.setRepos);
  const selected = useStore((s) => s.selectedSidebarPath === repo.path);
  const pinned = useStore((s) => s.sidebarPins.includes(repo.path));
  const togglePin = useStore((s) => s.toggleSidebarPin);
  const expanded = forceOpen || open;

  // Group: regular worktrees first, then a "✦ Claude" subgroup for parity with
  // the Rust TUI's visual treatment.
  const regular = worktrees.filter((w) => !w.isClaude);
  const claude = worktrees.filter((w) => w.isClaude);

  const onRemoveRepo = async () => {
    await window.treeline.repos.remove(repo.path);
    const cfg = await window.treeline.config.get();
    setRepos(cfg.repos);
  };

  /**
   * Always opens a fresh tab at the repo root — distinct from clicking a
   * worktree row, which focuses the MRU tab on that path. Use case: keep one
   * tab running `claude` to manage worktrees, plus a separate work tab on
   * the same repo root.
   */
  const onNewTerminal = () => void openTabAt(repo.path, { forceNew: true });

  return (
    <div className="group/repo mt-2" data-ss="repo-node" data-ss-repo={repo.path}>
      <div
        className={`flex items-center gap-1 rounded px-2 py-1 ${
          selected ? 'bg-treeline-highlight' : 'hover:bg-treeline-highlight'
        }`}
      >
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={expanded}
          className="flex flex-1 items-center gap-2 text-left text-treeline-text"
        >
          <span className="text-xs text-treeline-dim">{expanded ? '▾' : '▸'}</span>
          <span className="truncate font-medium">{repo.name}</span>
        </button>
        {!expanded && (
          <span className="flex shrink-0 items-center gap-1 text-[10px] text-treeline-dim group-hover/repo:hidden">
            <span>{totalWorktrees} wt</span>
            {activeWorktrees > 0 && (
              <span className="text-treeline-green">{activeWorktrees} open</span>
            )}
            {dirtyWorktrees > 0 && (
              <span className="text-treeline-yellow">{dirtyWorktrees} dirty</span>
            )}
          </span>
        )}
        <button
          type="button"
          onClick={() => togglePin(repo.path)}
          title={pinned ? 'Remove main worktree from Working' : 'Keep main worktree in Working'}
          aria-label={pinned ? 'Unpin main worktree' : 'Pin main worktree'}
          aria-pressed={pinned}
          className={`rounded px-1 hover:bg-treeline-surface group-hover/repo:opacity-100 ${
            pinned
              ? 'text-treeline-yellow opacity-100'
              : 'text-treeline-dim opacity-0 hover:text-treeline-text'
          }`}
        >
          {pinned ? '★' : '☆'}
        </button>
        <button
          type="button"
          onClick={onNewTerminal}
          title="New terminal at repo root"
          aria-label="New terminal at repo root"
          className="rounded px-1 font-mono text-[11px] text-treeline-dim opacity-0 hover:bg-treeline-surface hover:text-treeline-cyan group-hover/repo:opacity-100"
        >
          &gt;_
        </button>
        <button
          type="button"
          onClick={() => openModal({ kind: 'create-worktree', repoPath: repo.path })}
          title="New worktree"
          aria-label="New worktree"
          className="rounded px-1 text-treeline-dim opacity-0 hover:bg-treeline-surface hover:text-treeline-text group-hover/repo:opacity-100"
        >
          +
        </button>
        <button
          type="button"
          onClick={onRemoveRepo}
          title="Remove repo from sidebar"
          aria-label="Remove repo from sidebar"
          className="rounded px-1 text-treeline-dim opacity-0 hover:bg-treeline-surface hover:text-treeline-red group-hover/repo:opacity-100"
        >
          ×
        </button>
      </div>
      {expanded && (
        <ul className="mt-1 flex flex-col gap-px">
          {regular.map((w) => (
            <WorktreeRow key={w.path} worktree={w} repoPath={repo.path} />
          ))}
          {claude.length > 0 && (
            <>
              <li
                className={`mt-1 px-2 py-0.5 text-[10px] uppercase tracking-wide ${AGENTS.claude.colorClassDim}`}
              >
                {AGENTS.claude.glyph} {AGENTS.claude.label}
              </li>
              {claude.map((w) => (
                <WorktreeRow key={w.path} worktree={w} repoPath={repo.path} />
              ))}
            </>
          )}
        </ul>
      )}
    </div>
  );
}
