import { useState } from 'react';
import { useStore } from '../../store';
import { openTabAt } from '../../actions/tabs';
import { ModalShell } from './ModalShell';

type Mode = 'new-folder' | 'existing-folder';

/**
 * Modal that initializes a new git repo. Two modes:
 *   - new-folder:    pick a parent, type a name → app `mkdir`s and `git init`s.
 *   - existing-folder: pick a (presently empty, non-repo) folder → `git init`.
 *
 * On success the repo is added to the store, selected in the sidebar, and a
 * fresh terminal is opened at its root. Validation is done server-side; any
 * error is surfaced inline.
 */
export function CreateRepoModal() {
  const closeModal = useStore((s) => s.closeModal);
  const setRepos = useStore((s) => s.setRepos);
  const setWorktrees = useStore((s) => s.setWorktrees);
  const setSelected = useStore((s) => s.setSelected);

  const [mode, setMode] = useState<Mode>('new-folder');
  const [basePath, setBasePath] = useState('');
  const [folderName, setFolderName] = useState('');
  const [branch, setBranch] = useState('main');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onPick = async () => {
    const picked = await window.treeline.repos.pickDirectory();
    if (picked) setBasePath(picked);
  };

  const canSubmit =
    basePath.trim().length > 0 &&
    branch.trim().length > 0 &&
    (mode === 'existing-folder' || folderName.trim().length > 0);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!canSubmit) return;
    setBusy(true);
    try {
      const repo = await window.treeline.repos.create({
        mode,
        basePath: basePath.trim(),
        folderName: mode === 'new-folder' ? folderName.trim() : undefined,
        branch: branch.trim(),
      });

      // Sync sidebar state: refresh the repo list and the (empty) worktree
      // list for the newly-registered repo, select it, and drop the user
      // into a terminal at its root. RepoNode's local expand state defaults
      // to `true`, so "expanded" is automatic.
      const cfg = await window.treeline.config.get();
      setRepos(cfg.repos);
      const wts = await window.treeline.worktrees.list(repo.path);
      setWorktrees(repo.path, wts);
      setSelected(repo.path);
      await openTabAt(repo.path, { forceNew: true });
      closeModal();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const basePathLabel = mode === 'new-folder' ? 'Parent directory' : 'Directory';
  const basePathHint =
    mode === 'new-folder'
      ? 'Where the new folder will be created.'
      : 'An existing empty directory to initialize as a repo.';

  return (
    <ModalShell title="New repo" onClose={closeModal}>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        {/* Mode toggle */}
        <div className="flex gap-3 text-xs text-treeline-text" role="radiogroup" aria-label="Mode">
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              name="create-repo-mode"
              value="new-folder"
              checked={mode === 'new-folder'}
              onChange={() => setMode('new-folder')}
            />
            Create new folder
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              name="create-repo-mode"
              value="existing-folder"
              checked={mode === 'existing-folder'}
              onChange={() => setMode('existing-folder')}
            />
            Use existing folder
          </label>
        </div>

        {/* Base path: parent for new-folder, target for existing-folder. */}
        <label className="flex flex-col gap-1 text-xs text-treeline-dim">
          {basePathLabel}{' '}
          <span className="text-treeline-dim">({basePathHint})</span>
          <div className="flex gap-2">
            <input
              autoFocus
              type="text"
              value={basePath}
              onChange={(e) => setBasePath(e.target.value)}
              placeholder="/Users/you/code"
              className="flex-1 rounded bg-treeline-highlight px-2 py-1 text-treeline-text focus:outline-none focus:ring-1 focus:ring-treeline-cyan"
            />
            <button
              type="button"
              onClick={onPick}
              className="rounded border border-treeline-highlight px-2 py-1 text-treeline-text hover:bg-treeline-highlight"
            >
              Browse…
            </button>
          </div>
        </label>

        {/* Folder name input — only relevant in new-folder mode. */}
        {mode === 'new-folder' && (
          <label className="flex flex-col gap-1 text-xs text-treeline-dim">
            Folder name
            <input
              type="text"
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              placeholder="my-new-repo"
              className="rounded bg-treeline-highlight px-2 py-1 text-treeline-text focus:outline-none focus:ring-1 focus:ring-treeline-cyan"
            />
          </label>
        )}

        {/* Initial branch — editable, defaults to 'main'. */}
        <label className="flex flex-col gap-1 text-xs text-treeline-dim">
          Initial branch
          <input
            type="text"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            placeholder="main"
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
            disabled={busy || !canSubmit}
            className="rounded bg-treeline-cyan px-3 py-1 text-treeline-surface disabled:opacity-50"
          >
            {busy ? 'Creating…' : 'Create'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
