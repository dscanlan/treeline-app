import { useCallback, useEffect, useState } from 'react';
import type { WorktreeMaintenance } from '@shared/types';
import { useStore } from '../../store';
import { ModalShell } from './ModalShell';

export function WorktreeMaintenanceModal({ repoPath }: { repoPath: string }) {
  const closeModal = useStore((s) => s.closeModal);
  const [check, setCheck] = useState<WorktreeMaintenance | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmPrune, setConfirmPrune] = useState(false);

  const refresh = useCallback(async () => {
    // Publish inspection even if an unrelated slow status call subsequently fails.
    setCheck(null);
    const result = await window.treeline.worktrees.inspect(repoPath);
    setCheck(result);
    setConfirmPrune(false);
    const worktrees = await window.treeline.worktrees.list(repoPath);
    useStore.getState().setWorktrees(repoPath, worktrees);
  }, [repoPath]);

  const run = async (action?: () => Promise<void>, success?: string) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    setConfirmPrune(false);
    try {
      if (action) await action();
      if (success) setMessage(success);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      // Repair can fix some links and still fail for another. Always recheck.
      try {
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
      setBusy(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    void refresh()
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const repairMoved = () =>
    void run(async () => {
      const path = await window.treeline.repos.pickDirectory();
      if (path) await window.treeline.worktrees.repair(repoPath, path);
    });
  const button =
    'rounded border border-treeline-border px-2 py-1 hover:bg-treeline-highlight disabled:opacity-50';

  return (
    <ModalShell
      title="Worktree maintenance"
      onClose={() => {
        if (!busy) closeModal();
      }}
    >
      <div className="flex max-h-[75vh] flex-col gap-3 overflow-y-auto text-sm">
        <p className="break-all text-xs text-treeline-dim">{repoPath}</p>
        <p>
          Repair broken Git links or remove stale worktree registrations. Detached worktrees are
          normal checkouts at a specific commit.
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={button} disabled={busy} onClick={() => void run()}>
            Refresh
          </button>
          <button
            type="button"
            className={button}
            disabled={busy}
            onClick={() =>
              void run(
                () => window.treeline.worktrees.repair(repoPath),
                'Repair completed. Remaining issues are listed below.',
              )
            }
          >
            Repair links
          </button>
          <button type="button" className={button} disabled={busy} onClick={repairMoved}>
            Locate moved worktree…
          </button>
        </div>
        <p className="text-xs text-treeline-dim">
          Repair preserves files and commits. If you moved a worktree, select its new folder before
          pruning.
        </p>
        {busy && (
          <p role="status" className="text-treeline-dim">
            Checking worktrees…
          </p>
        )}
        {message && (
          <p role="status" className="text-treeline-green">
            {message}
          </p>
        )}
        {error && (
          <p role="alert" className="break-words text-xs text-treeline-red">
            {error}
          </p>
        )}
        {check && (
          <>
            <ul className="flex flex-col gap-2">
              {check.worktrees.map((wt) => (
                <li key={wt.path} className="rounded border border-treeline-border p-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="break-all">{wt.branch || 'Worktree'}</span>
                    <code className="text-treeline-dim">{wt.commit}</code>
                    {wt.locked !== undefined && (
                      <span title={wt.locked} className="text-treeline-yellow">
                        locked
                      </span>
                    )}
                  </div>
                  <p className="mt-1 break-all text-treeline-dim">{wt.path}</p>
                  {wt.issue && <p className="mt-1 break-words text-treeline-yellow">{wt.issue}</p>}
                </li>
              ))}
            </ul>
            {check.prunePreview ? (
              <div className="flex flex-col gap-2 rounded border border-treeline-border p-2 text-xs">
                <p>
                  Git would remove these stale registrations. Remaining folders and files are kept.
                  Locked and healthy detached worktrees are kept.
                </p>
                <pre className="max-h-36 overflow-y-auto whitespace-pre-wrap break-all text-treeline-dim">
                  {check.prunePreview}
                </pre>
                {confirmPrune ? (
                  <>
                    <p>Prune these registrations from this repository?</p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className={button}
                        disabled={busy}
                        onClick={() => setConfirmPrune(false)}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className={`${button} text-treeline-yellow`}
                        disabled={busy}
                        onClick={() =>
                          void run(
                            () => window.treeline.worktrees.prune(repoPath, check.prunePreview),
                            'Stale registrations pruned. Remaining folders and files were kept.',
                          )
                        }
                      >
                        Confirm prune
                      </button>
                    </div>
                  </>
                ) : (
                  <button
                    type="button"
                    className={`${button} self-start`}
                    disabled={busy}
                    onClick={() => setConfirmPrune(true)}
                  >
                    Prune stale entries…
                  </button>
                )}
              </div>
            ) : (
              <p className="text-xs text-treeline-dim">No stale registrations to prune.</p>
            )}
          </>
        )}
      </div>
    </ModalShell>
  );
}
