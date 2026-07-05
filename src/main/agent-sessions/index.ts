import type { AgentKind } from '@shared/agents';
import type { AgentSessionStore } from './types';
import { claudeSessionStore } from './claude';
import { aiderSessionStore } from './aider';

export type { AgentSessionRef, AgentSessionStore } from './types';

/**
 * The main-process session-store registry: which agents can answer "what
 * session was running in this cwd". Partial by design — an agent with no
 * store (opencode until its storage layout is verified; codex until its
 * detection lands) resolves to "nothing to resume", the same contract the
 * renderer already handles. Keep this in sync with the shared registry's
 * `sessionStore` capability flags (`shared/agents.ts`), which is what gates
 * the UI.
 */
export const SESSION_STORES: Partial<Record<AgentKind, AgentSessionStore>> = {
  claude: claudeSessionStore,
  aider: aiderSessionStore,
};

/** The store for `kind`, or null when that agent has none. */
export function sessionStoreFor(kind: string): AgentSessionStore | null {
  return SESSION_STORES[kind as AgentKind] ?? null;
}
