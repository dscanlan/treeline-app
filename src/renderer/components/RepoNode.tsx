import { useState } from 'react';
import type { Repo } from '@shared/types';
import { useStore } from '../store';
import { WorktreeRow } from './WorktreeRow';
import { openTabAt } from '../actions/tabs';

interface Props {
  repo: Repo;
}

export function RepoNode({ repo }: Props) {
  const [open, setOpen] = useState(true);
  const worktrees = useStore((s) => s.worktreesByRepo[repo.path] ?? []);
  const filter = useStore((s) => s.filter.toLowerCase());
  const openModal = useStore((s) => s.openModal);
  const setRepos = useStore((s) => s.setRepos);

  const filtered = filter
    ? worktrees.filter(
        (w) =>
          w.branch.toLowerCase().includes(filter) ||
          w.path.toLowerCase().includes(filter),
      )
    : worktrees;

  // Group: regular worktrees first, then a "✦ Claude" subgroup for parity with
  // the Rust TUI's visual treatment.
  const regular = filtered.filter((w) => !w.isClaude);
  const claude = filtered.filter((w) => w.isClaude);

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
    <div className="group/repo mt-2">
      <div className="flex items-center gap-1 rounded px-2 py-1 hover:bg-treeline-highlight">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex flex-1 items-center gap-2 text-left text-treeline-text"
        >
          <span className="text-xs text-treeline-dim">{open ? '▾' : '▸'}</span>
          <span className="truncate font-medium">{repo.name}</span>
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
      {open && (
        <ul className="mt-1 flex flex-col gap-px">
          {regular.length === 0 && claude.length === 0 ? (
            <li className="px-2 py-1 text-xs text-treeline-dim">no worktrees</li>
          ) : (
            <>
              {regular.map((w) => (
                <WorktreeRow key={w.path} worktree={w} repoPath={repo.path} />
              ))}
              {claude.length > 0 && (
                <>
                  <li className="mt-1 px-2 py-0.5 text-[10px] uppercase tracking-wide text-treeline-magenta/70">
                    ✦ Claude
                  </li>
                  {claude.map((w) => (
                    <WorktreeRow key={w.path} worktree={w} repoPath={repo.path} />
                  ))}
                </>
              )}
            </>
          )}
        </ul>
      )}
    </div>
  );
}
