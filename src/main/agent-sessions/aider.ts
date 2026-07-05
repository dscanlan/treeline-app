import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentSessionStore } from './types';

/**
 * aider keeps chat history in a cwd-keyed file (`.aider.chat.history.md` in
 * the directory it ran in) and resumes it with the id-less
 * `aider --restore-chat-history`. So "the latest session for a cwd" is simply
 * that file's existence/mtime, and the id is a pseudo-id (the cwd itself) —
 * the resume capability ignores ids for aider anyway (`resumeWithoutId`).
 *
 * No `copySessionToCwd`: copying the history file into a worktree is
 * plausible but unverified (aider isn't installed to prove it picks the copy
 * up), so the capability is honestly absent — the handoff toast never offers
 * aider until it's real.
 */

export const AIDER_HISTORY_FILE = '.aider.chat.history.md';

export async function latestAiderSessionForCwd(
  cwd: string,
): Promise<{ id: string; path: string; mtimeMs: number } | null> {
  const path = join(cwd, AIDER_HISTORY_FILE);
  try {
    const info = await stat(path);
    if (!info.isFile()) return null;
    return { id: cwd, path, mtimeMs: info.mtimeMs };
  } catch {
    return null; // no history file → nothing to resume here
  }
}

export const aiderSessionStore: AgentSessionStore = {
  kind: 'aider',
  latestSessionForCwd: latestAiderSessionForCwd,
};
