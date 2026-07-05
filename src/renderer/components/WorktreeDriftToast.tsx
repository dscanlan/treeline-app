import { useState } from 'react';
import { AGENT_LIST, AGENTS, type AgentKind } from '@shared/agents';
import { useStore } from '../store';
import type { AppStore } from '../store';
import { openDriftedWorktree, resumeSessionInWorktree } from '../actions/tabs';

/**
 * Which agent a "Continue in new tab" handoff would continue, for a freshly
 * created worktree — or null when no handoff should be offered. The origin is
 * the worktree's parent repo (where the agent that created it runs): resolve
 * it from the worktree lists, look up the agents detected running there, and
 * default to claude when none is detected (matching the pre-registry offer).
 * Capability-gated: the kind must have both a fork command and a session
 * store that can copy a session into another directory — anything less would
 * be a false promise.
 */
function handoffKindFor(s: AppStore, toWorktree: string): AgentKind | null {
  const repoPath = Object.entries(s.worktreesByRepo).find(([, wts]) =>
    wts.some((w) => w.path === toWorktree),
  )?.[0];
  const running = new Set(
    (repoPath ? (s.processesByWorktreePath[repoPath] ?? []) : []).map((p) => p.kind),
  );
  const kind = AGENT_LIST.find((a) => running.has(a.kind))?.kind ?? 'claude';
  const def = AGENTS[kind];
  return def.resume?.fork && def.sessionStore?.canCopyToCwd ? kind : null;
}

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
  // The agent a handoff would continue (null → no Continue offer, e.g. the
  // origin runs an agent whose sessions can't follow a directory move).
  const handoffKind = useStore((s) =>
    head?.reason === 'created' ? handoffKindFor(s, head.toWorktree) : null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!head) return null;
  const basename =
    head.toWorktree.split('/').filter(Boolean).pop() ?? head.toWorktree;
  const body =
    head.reason === 'created'
      ? 'A new worktree was created.'
      : 'A terminal moved into this worktree.';
  const handoffLabel = handoffKind ? AGENTS[handoffKind].label : null;

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

  const onResume = async () => {
    if (!handoffKind) return;
    setError(null);
    setBusy(true);
    try {
      await resumeSessionInWorktree(head.toWorktree, handoffKind);
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
        <h3 className="text-sm text-treeline-cyan">
          {head.reason === 'created' && handoffLabel
            ? `Continue ${handoffLabel} in ${basename}?`
            : `Open a terminal in ${basename}?`}
        </h3>
        {queueLen > 1 && (
          <span className="text-xs text-treeline-dim">+{queueLen - 1} more</span>
        )}
      </div>
      <p className="mb-3 break-all text-xs text-treeline-dim">{body}</p>
      <div className="flex flex-wrap items-center gap-2">
        {/* A plain terminal is the useful action for drift (a cwd that moved
          * into a worktree), and the fallback for a created worktree whose
          * origin agent can't be handed off — "Continue" below is only
          * offered when the handoff is real. */}
        {!(head.reason === 'created' && handoffLabel) && (
          <button
            type="button"
            onClick={onOpen}
            disabled={busy}
            className="rounded border border-treeline-highlight bg-treeline-highlight px-2 py-1 text-xs text-treeline-text hover:opacity-90 disabled:opacity-50"
          >
            {busy ? 'Opening…' : 'Open'}
          </button>
        )}
        {head.reason === 'created' && handoffLabel && (
          <button
            type="button"
            onClick={onResume}
            disabled={busy}
            title={`Copy this repo's active ${handoffLabel} conversation into the worktree and continue it in a new tab (the original is paused)`}
            className="rounded border border-treeline-cyan bg-treeline-cyan px-2 py-1 text-xs text-treeline-surface hover:opacity-90 disabled:opacity-50"
          >
            {busy ? 'Continuing…' : `Continue ${handoffLabel} in new tab`}
          </button>
        )}
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
