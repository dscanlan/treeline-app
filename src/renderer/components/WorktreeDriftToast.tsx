import { useState } from 'react';
import { useStore } from '../store';
import { openDriftedWorktree } from '../actions/tabs';

/**
 * Bottom-right toast offering to open a terminal in a worktree, surfaced when
 * either a new worktree is created (e.g. an agent ran `git worktree add`) or a
 * terminal's cwd drifts into a different worktree (manual `cd`). Without this,
 * treeline keeps behaving as if work were still happening in the original
 * worktree.
 *
 * Stacks above the {@link DiscoveredRepoToast} (which owns `bottom-4`). Renders
 * the first pending suggestion; the rest surface as the user clears each one.
 */
export function WorktreeDriftToast() {
  const head = useStore((s) => Object.values(s.driftByWorktree)[0]);
  const queueLen = useStore((s) => Object.keys(s.driftByWorktree).length);
  const dismiss = useStore((s) => s.dismissWorktreeOpen);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!head) return null;
  const basename =
    head.toWorktree.split('/').filter(Boolean).pop() ?? head.toWorktree;
  const body =
    head.reason === 'created'
      ? 'A new worktree was created.'
      : 'A terminal moved into this worktree.';

  const onOpen = async () => {
    setError(null);
    setBusy(true);
    try {
      await openDriftedWorktree(head.toWorktree);
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
      className="fixed bottom-24 right-4 z-40 w-80 rounded border border-treeline-highlight bg-treeline-surface p-3 text-treeline-text shadow-2xl"
    >
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h3 className="text-sm text-treeline-cyan">Open a terminal in {basename}?</h3>
        {queueLen > 1 && (
          <span className="text-xs text-treeline-dim">+{queueLen - 1} more</span>
        )}
      </div>
      <p className="mb-3 break-all text-xs text-treeline-dim">{body}</p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onOpen}
          disabled={busy}
          className="rounded border border-treeline-highlight bg-treeline-highlight px-2 py-1 text-xs text-treeline-text hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'Opening…' : 'Open'}
        </button>
        <button
          type="button"
          onClick={() => dismiss(head.toWorktree)}
          disabled={busy}
          className="rounded border border-treeline-highlight px-2 py-1 text-xs text-treeline-dim hover:bg-treeline-highlight hover:text-treeline-text disabled:opacity-50"
        >
          Dismiss
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-treeline-red">{error}</p>}
    </div>
  );
}
