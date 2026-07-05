import { ipcMain } from 'electron';
import { AGENTS } from '@shared/agents';
import { Channels } from '@shared/ipc-channels';
import { resolveParentRepoPath } from '../git';
import { sessionStoreFor } from '../agent-sessions';
import { validateAbsPath } from '../util/safe-path';
import type { PtyManager } from '../pty-manager';

/** Renderer input is untrusted — reject anything that isn't a known kind. */
function validateKind(raw: unknown): string {
  if (typeof raw !== 'string' || !(raw in AGENTS)) {
    throw new Error(`unknown agent kind: ${JSON.stringify(raw)}`);
  }
  return raw;
}

/**
 * IPC for resuming an agent conversation, dispatched per-kind through the
 * session-store registry (main/agent-sessions/). A kind with no store — or a
 * store without copy support, for prepareResume — resolves null: the same
 * "nothing to resume" contract the renderer has always handled.
 *
 * Agents key sessions by the directory they ran in, so a session started in a
 * repo's main checkout can't be seen from a worktree. `prepareResume` bridges
 * that: it resolves the worktree's parent repo (the directory the agent that
 * created the worktree was running in), finds that directory's most-recent
 * session, and copies it into the worktree's store so the agent's resume
 * command finds it there. The renderer then opens a terminal in the worktree
 * and runs that command.
 */
export function registerAgentSessionIpc(ptyManager: PtyManager): () => void {
  ipcMain.handle(
    Channels.AgentSessionPrepareResume,
    async (_e, rawPath: unknown, rawKind: unknown) => {
      const worktreePath = validateAbsPath(rawPath);
      const store = sessionStoreFor(validateKind(rawKind));
      if (!store?.copySessionToCwd) return null; // can't follow a directory move

      // The origin cwd is the worktree's parent working tree — where the agent
      // that ran `git worktree add` lives, and therefore where its session is.
      const originRepo = await resolveParentRepoPath(worktreePath);
      if (!originRepo || originRepo === worktreePath) return null;

      const session = await store.latestSessionForCwd(originRepo);
      if (!session) return null;

      await store.copySessionToCwd(session, worktreePath);
      return { sessionId: session.id, originCwd: originRepo };
    },
  );

  // The latest session id for a cwd under a kind, no copy. Session-restore
  // uses this to re-run the agent's resume command in a respawned pane that
  // was running it when the layout was saved — the session already lives in
  // that cwd's store, so unlike prepareResume nothing needs copying across.
  ipcMain.handle(
    Channels.AgentSessionLatestForCwd,
    async (_e, rawCwd: unknown, rawKind: unknown) => {
      const cwd = validateAbsPath(rawCwd);
      const store = sessionStoreFor(validateKind(rawKind));
      if (!store) return null;
      const session = await store.latestSessionForCwd(cwd);
      return session?.id ?? null;
    },
  );

  // pane id → kind-tagged session id, as reported by each pane's session-start
  // hook (over the CLI socket). The renderer's debounced session save pins
  // these per-pane — exact even when two panes share a cwd, where latestForCwd
  // can't tell the conversations apart.
  ipcMain.handle(Channels.AgentSessionIdsByPane, () => ptyManager.agentSessionIds());

  return () => {
    ipcMain.removeHandler(Channels.AgentSessionPrepareResume);
    ipcMain.removeHandler(Channels.AgentSessionLatestForCwd);
    ipcMain.removeHandler(Channels.AgentSessionIdsByPane);
  };
}
