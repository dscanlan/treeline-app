import { useState } from 'react';
import { useStore } from '../store';
import { restoreSession } from '../actions/tabs';

/**
 * Cold-start restore offer. When the app relaunches after a full restart (an
 * auto-update or a reboot — main died, so no PTYs survived to reattach) and a
 * non-empty tab layout was saved to disk, `loadInitialState` stages it in
 * `pendingRestore` and this modal asks before bringing anything back. Nothing
 * respawns and no `claude --resume` runs until the user clicks Restore — the
 * deliberate difference from the silent reload-time reattach.
 *
 * Dismiss discards the saved session so a launch the user chose not to restore
 * doesn't nag again; the next tab change repersists whatever's open.
 */
export function RestorePrompt() {
  const pending = useStore((s) => s.pendingRestore);
  const clearPending = useStore((s) => s.clearPendingRestore);
  const [restoring, setRestoring] = useState(false);

  if (!pending) return null;
  const count = pending.tabs.length;

  const onRestore = async (): Promise<void> => {
    setRestoring(true);
    try {
      await restoreSession(pending);
    } finally {
      // Clearing pendingRestore re-enables the debounced save, which then
      // persists the freshly-restored tabs.
      clearPending();
    }
  };

  const onDismiss = (): void => {
    clearPending();
    // Discard the saved layout so we don't re-prompt next launch.
    void window.treeline.session.set({ version: 1, tabs: [], activeTabId: null });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Restore previous session"
        className="w-80 rounded-lg border border-treeline-highlight bg-treeline-surface p-4 shadow-2xl"
      >
        <h2 className="text-sm font-semibold text-treeline-text">Restore previous session?</h2>
        <p className="mt-2 text-xs text-treeline-dim">
          {count === 1 ? '1 tab' : `${count} tabs`} from your last session can be
          reopened. Terminals respawn in their folders, and panes that were running
          Claude resume their conversation.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onDismiss}
            disabled={restoring}
            className="rounded border border-treeline-highlight px-3 py-1 text-xs text-treeline-dim hover:text-treeline-text disabled:opacity-50"
          >
            Not now
          </button>
          <button
            type="button"
            onClick={() => void onRestore()}
            disabled={restoring}
            className="rounded bg-treeline-cyan px-3 py-1 text-xs font-medium text-treeline-surface hover:opacity-90 disabled:opacity-50"
          >
            {restoring ? 'Restoring…' : 'Restore'}
          </button>
        </div>
      </div>
    </div>
  );
}
