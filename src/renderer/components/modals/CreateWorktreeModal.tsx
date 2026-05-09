import { useState } from 'react';
import { useStore } from '../../store';
import { ModalShell } from './ModalShell';

interface Props {
  repoPath: string;
}

export function CreateWorktreeModal({ repoPath }: Props) {
  const closeModal = useStore((s) => s.closeModal);
  const [branch, setBranch] = useState('');
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Default the path to <repo>/<branch> as the user types — common case.
  const effectivePath = path.trim().length > 0 ? path.trim() : branch ? `${repoPath}/${branch}` : '';

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!branch.trim()) {
      setError('Branch name is required.');
      return;
    }
    setBusy(true);
    try {
      await window.treeline.worktrees.create(repoPath, branch.trim(), effectivePath);
      // Watcher will broadcast the change; renderer's `worktrees:onChange`
      // subscriber will refresh the sidebar.
      closeModal();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell title="New worktree" onClose={closeModal}>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-xs text-treeline-dim">
          Branch
          <input
            autoFocus
            type="text"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            placeholder="feat/auth"
            className="rounded bg-treeline-highlight px-2 py-1 text-treeline-text focus:outline-none focus:ring-1 focus:ring-treeline-cyan"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-treeline-dim">
          Path <span className="text-treeline-dim">(defaults to {repoPath}/&lt;branch&gt;)</span>
          <input
            type="text"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder={effectivePath || `${repoPath}/<branch>`}
            className="rounded bg-treeline-highlight px-2 py-1 text-treeline-text focus:outline-none focus:ring-1 focus:ring-treeline-cyan"
          />
        </label>
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
            type="submit"
            disabled={busy || !branch.trim()}
            className="rounded bg-treeline-cyan px-3 py-1 text-treeline-surface disabled:opacity-50"
          >
            {busy ? 'Creating…' : 'Create'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
