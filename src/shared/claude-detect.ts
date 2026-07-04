// Compatibility shim over the shared agent registry. The detection rule
// itself now lives on the `claude` entry in `shared/agents.ts`.

import { detectAgentWorktree } from './agents';

/**
 * @deprecated Use `detectAgentWorktree(absPath, branch)` from
 * `@shared/agents` instead — this shim only answers the Claude-or-not
 * question and is removed once the sidebar groups worktrees by agent kind.
 */
export function detectClaudeWorktree(absPath: string, branch: string): boolean {
  return detectAgentWorktree(absPath, branch) === 'claude';
}
