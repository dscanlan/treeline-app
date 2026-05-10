import { useState } from 'react';
import { useStore } from '../store';

/**
 * Bottom-right toast that surfaces untracked git repos noticed via PTY cwds.
 * Shows the head of `pendingDiscoveries`; subsequent discoveries queue
 * silently behind it and appear as the user clears each one.
 *
 * Three actions:
 *   - **Add**: persist to the repos list and start watching for worktrees.
 *   - **Dismiss**: in-session only — won't re-prompt this session, will
 *     re-prompt on next launch if cwd lands inside the repo again.
 *   - **Don't ask again**: persists the path to `dismissedRepos`.
 */
export function DiscoveredRepoToast() {
  const head = useStore((s) => s.pendingDiscoveries[0]);
  const queueLen = useStore((s) => s.pendingDiscoveries.length);
  const dismiss = useStore((s) => s.dismissDiscovery);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!head) return null;
  const basename = head.repoPath.split('/').filter(Boolean).pop() ?? head.repoPath;
  // Show only the trailing segment of viaCwd (typically the worktree name when
  // the discovery came from a Claude worktree path). The full repoPath is
  // already shown above, so the new information is the *suffix*, not the
  // whole path. Avoids the toast wrapping and clipping on long paths.
  const viaSuffix =
    head.viaCwd === head.repoPath
      ? null
      : (head.viaCwd.split('/').filter(Boolean).pop() ?? head.viaCwd);

  const onAdd = async () => {
    setError(null);
    setBusy(true);
    try {
      // The IPC may resolve the path to a parent (if `repoPath` was a worktree
      // that we surfaced via cwd-changed before we knew it was inside a bigger
      // repo). Use the returned canonical path everywhere downstream.
      const added = await window.treeline.repos.add(head.repoPath);
      const cfg = await window.treeline.config.get();
      useStore.getState().setRepos(cfg.repos);
      const wts = await window.treeline.worktrees.list(added.path);
      useStore.getState().setWorktrees(added.path, wts);
      // Park focus on the just-added repo so the user can immediately click
      // through to its worktrees without hunting in the sidebar.
      useStore.getState().setSelected(added.path);
      dismiss(head.repoPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const onDismiss = () => dismiss(head.repoPath);

  const onDontAskAgain = async () => {
    setError(null);
    setBusy(true);
    try {
      await window.treeline.repos.dismissDiscovered(head.repoPath);
      dismiss(head.repoPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-40 w-80 rounded border border-treeline-highlight bg-treeline-surface p-3 text-treeline-text shadow-2xl"
    >
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h3 className="text-sm text-treeline-cyan">Track {basename}?</h3>
        {queueLen > 1 && (
          <span className="text-xs text-treeline-dim">+{queueLen - 1} more</span>
        )}
      </div>
      <p className="mb-2 break-all text-xs text-treeline-dim">{head.repoPath}</p>
      <p className="mb-3 truncate text-xs text-treeline-dim">
        Noticed a worktree at {viaSuffix ?? 'this path'}.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onAdd}
          disabled={busy}
          className="rounded border border-treeline-highlight bg-treeline-highlight px-2 py-1 text-xs text-treeline-text hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'Adding…' : 'Add'}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          disabled={busy}
          className="rounded border border-treeline-highlight px-2 py-1 text-xs text-treeline-dim hover:bg-treeline-highlight hover:text-treeline-text disabled:opacity-50"
        >
          Dismiss
        </button>
        <button
          type="button"
          onClick={onDontAskAgain}
          disabled={busy}
          className="ml-auto text-xs text-treeline-dim underline-offset-2 hover:text-treeline-text hover:underline disabled:opacity-50"
        >
          Don&apos;t ask again
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-treeline-red">{error}</p>}
    </div>
  );
}
