import { useState } from 'react';
import { useStore } from '../../store';
import { ModalShell } from './ModalShell';
import { closeTab } from '../../actions/tabs';

interface Props {
  repoPath: string;
  worktreePath: string;
  branch: string;
}

export function DeleteWorktreeModal({ repoPath, worktreePath, branch }: Props) {
  const closeModal = useStore((s) => s.closeModal);
  const tabsOnPath = useStore((s) => s.tabsByCwd[worktreePath] ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onConfirm = async () => {
    setError(null);
    setBusy(true);
    try {
      // Close any tabs still bound to this worktree first so xterm doesn't
      // keep talking to a vanished cwd.
      for (const id of [...tabsOnPath]) {
        // eslint-disable-next-line no-await-in-loop
        await closeTab(id);
      }
      await window.treeline.worktrees.remove(worktreePath);
      // Force a refresh so the sidebar updates immediately even if fs.watch
      // misses the event.
      const wts = await window.treeline.worktrees.list(repoPath);
      useStore.getState().setWorktrees(repoPath, wts);
      closeModal();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell title="Delete worktree?" onClose={closeModal}>
      <div className="flex flex-col gap-3">
        <p className="text-sm">
          Remove worktree <span className="text-treeline-magenta">{branch}</span>?
        </p>
        <p className="text-xs text-treeline-dim">{worktreePath}</p>
        {tabsOnPath.length > 0 && (
          <div className="rounded border border-treeline-highlight bg-treeline-highlight/40 p-2 text-xs">
            <span className="text-treeline-yellow">
              {tabsOnPath.length} open tab{tabsOnPath.length === 1 ? '' : 's'} will be closed.
            </span>
          </div>
        )}
        {error && <div className="text-xs text-treeline-red">{error}</div>}
        <div className="mt-1 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={closeModal}
            className="rounded px-3 py-1 text-treeline-dim hover:text-treeline-text"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="rounded bg-treeline-red px-3 py-1 text-treeline-surface disabled:opacity-50"
          >
            {busy ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
