import type { AgentKind } from '@shared/agents';

/**
 * One agent's saved session as a store reports it. `id` semantics are
 * per-agent: Claude's is the transcript basename (the `--resume` arg);
 * aider's is a pseudo-id (the cwd) since its history is cwd-keyed and its
 * resume is id-less.
 */
export interface AgentSessionRef {
  id: string;
  /** Absolute path to the session's backing file. */
  path: string;
  /** mtime (epoch ms). Newest wins as "the session currently running here". */
  mtimeMs: number;
}

/**
 * How one agent answers "what session was running in this cwd" and (when it
 * can) "carry this session into another directory". Each adapter is a pure
 * fs module living in main (it touches node:fs — deliberately NOT in
 * shared/); the shared registry entry only flags that the capability exists
 * so the renderer can gate UI without an IPC round-trip.
 *
 * Honest scoping: agents that can't answer a question simply don't implement
 * it — `copySessionToCwd` is optional, and a missing store means "nothing to
 * resume", never an error.
 */
export interface AgentSessionStore {
  kind: AgentKind;
  /** Newest session for a cwd, or null. */
  latestSessionForCwd(cwd: string): Promise<AgentSessionRef | null>;
  /**
   * Make `session` resumable from `toCwd` (worktree handoff). Optional —
   * absent means this agent's sessions can't follow a directory move.
   * Returns the destination path.
   */
  copySessionToCwd?(session: { id: string; path: string }, toCwd: string): Promise<string>;
}
