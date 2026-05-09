import { useState } from 'react';
import { useStore } from '../store';

export function AddRepoButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onClick = async () => {
    setError(null);
    setBusy(true);
    try {
      const picked = await window.treeline.repos.pickDirectory();
      if (!picked) return;
      await window.treeline.repos.add(picked);

      // Refresh repos + worktrees from main.
      const cfg = await window.treeline.config.get();
      useStore.getState().setRepos(cfg.repos);
      const wts = await window.treeline.worktrees.list(picked);
      useStore.getState().setWorktrees(picked, wts);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="rounded border border-treeline-highlight px-2 py-1 text-treeline-text hover:bg-treeline-highlight disabled:opacity-50"
      >
        {busy ? 'Adding…' : '+ Add repo'}
      </button>
      {error && <span className="text-xs text-treeline-red">{error}</span>}
    </div>
  );
}
