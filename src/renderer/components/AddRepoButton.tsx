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
      const res = await window.treeline.repos.addPath(picked);

      // Refresh from main. A git path becomes a repo (load its worktrees);
      // anything else becomes a plain folder root (a bare file tree).
      const cfg = await window.treeline.config.get();
      if (res.kind === 'repo') {
        useStore.getState().setRepos(cfg.repos);
        const wts = await window.treeline.worktrees.list(res.repo.path);
        useStore.getState().setWorktrees(res.repo.path, wts);
      } else {
        useStore.getState().setFolders(cfg.folders);
      }
      useStore.getState().setSidebarMode('library');
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
        title="Add a git repo (root, subdirectory, or worktree path — resolved to the parent repo) or pin any plain folder as a file tree."
        className="rounded border border-treeline-highlight px-2 py-1 text-treeline-text hover:bg-treeline-highlight disabled:opacity-50"
      >
        {busy ? 'Adding…' : '+ Add repo / folder'}
      </button>
      {error && <span className="text-xs text-treeline-red">{error}</span>}
    </div>
  );
}
