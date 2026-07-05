import { useState } from 'react';
import { AGENT_LIST, AGENTS } from '@shared/agents';
import { persistedLeaves } from '@shared/session-serialize';
import type { PersistedSession } from '@shared/types';
import { useStore } from '../store';
import { restoreSession } from '../actions/tabs';

/**
 * Human summary of what will actually resume, from the saved leaves: counts
 * per agent kind that has a resume capability, in registry order — e.g.
 * "2 Claude conversations and 1 opencode session". Empty string when nothing
 * will resume (plain shells only).
 */
function resumeSummary(pending: PersistedSession): string {
  const counts = new Map<string, number>();
  for (const tab of pending.tabs) {
    for (const leaf of persistedLeaves(tab.root)) {
      if (leaf.agentKind && AGENTS[leaf.agentKind].resume) {
        counts.set(leaf.agentKind, (counts.get(leaf.agentKind) ?? 0) + 1);
      }
    }
  }
  const parts = AGENT_LIST.filter((a) => counts.has(a.kind)).map((a) => {
    const n = counts.get(a.kind)!;
    const noun = a.kind === 'claude' ? 'conversation' : 'session';
    return `${n} ${a.label} ${noun}${n === 1 ? '' : 's'}`;
  });
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/**
 * Cold-start restore offer. When the app relaunches after a full restart (an
 * auto-update or a reboot — main died, so no PTYs survived to reattach) and a
 * non-empty tab layout was saved to disk, `loadInitialState` stages it in
 * `pendingRestore` and this modal asks before bringing anything back. Nothing
 * respawns and no agent resume command runs until the user clicks Restore —
 * the deliberate difference from the silent reload-time reattach.
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
  const resumes = resumeSummary(pending);

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
          reopened. Terminals respawn in their folders
          {resumes ? `, and ${resumes} will resume` : ''}.
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
