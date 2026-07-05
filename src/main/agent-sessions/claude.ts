import { mkdir, readdir, stat, copyFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AgentSessionStore } from './types';

/**
 * Claude Code persists each conversation's transcript at
 * `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`, where the folder name
 * is the working directory with every `/` and `.` replaced by `-`. `claude
 * --resume <id>` resolves that path from the **current** cwd's folder, so a
 * session started in a repo's main checkout cannot be resumed from one of its
 * worktrees (a different directory → a different folder) unless its transcript
 * is first copied across. This module finds the active session for a directory
 * and performs that copy — the only mechanism by which the *same* conversation
 * can continue in a freshly-created worktree.
 *
 * It's intentionally a pure fs module (no Electron) so it's unit-testable; the
 * IPC layer in ipc/agent-session.ts resolves the origin repo and calls in
 * through the {@link claudeSessionStore} adapter.
 */

/**
 * Encode a working directory into Claude Code's per-project folder name: every
 * character that isn't `[a-zA-Z0-9]` becomes `-` (e.g.
 * `/Users/me/code/app/.claude/worktrees/x` → `-Users-me-code-app--claude-worktrees-x`,
 * and `/Users/me/obsidian_notes` → `-Users-me-obsidian-notes`). This mirrors
 * Claude's own scheme, verified against the real `~/.claude/projects` layout —
 * note it replaces `_` (and spaces, etc.) too, not just `/` and `.`, so a repo
 * path containing an underscore still resolves to the right project folder.
 */
export function encodeProjectDir(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

/** Absolute path to `~/.claude/projects` (overridable for tests). */
export function claudeProjectsRoot(home: string = homedir()): string {
  return join(home, '.claude', 'projects');
}

export interface ClaudeSession {
  /** Session id — the transcript's basename sans `.jsonl`; the `--resume` arg. */
  id: string;
  /** Absolute path to the transcript `.jsonl`. */
  path: string;
  /** mtime (epoch ms). Newest wins as "the session currently running here". */
  mtimeMs: number;
}

/**
 * The most-recently-modified Claude transcript for `cwd`, or null when that
 * directory has no Claude sessions (no project folder, or it holds no
 * `.jsonl`). "Newest mtime" is the heuristic for "the live session" — when an
 * agent in a repo's main checkout spins up a worktree, the conversation that
 * did so is, in practice, the most recently written one for that directory.
 *
 * We deliberately do NOT inspect transcript contents to skip "stubs" that lack
 * an `assistant` turn. A `bridge-session` marker (written when a session
 * continues across a model switch / compaction) has no `assistant` line yet IS
 * the valid `--resume` pointer to the live conversation, and it carries the
 * newest mtime right after the bridge. Filtering it out made `latestSessionForCwd`
 * fall back to an older transcript, so a worktree handoff resumed the WRONG/older
 * session — newest-by-mtime is the conversation the user is actually in.
 */
export async function latestSessionForCwd(
  cwd: string,
  projectsRoot: string = claudeProjectsRoot(),
): Promise<ClaudeSession | null> {
  const dir = join(projectsRoot, encodeProjectDir(cwd));
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return null; // no project folder → no sessions for this cwd
  }

  let best: ClaudeSession | null = null;
  for (const name of names) {
    if (!name.endsWith('.jsonl')) continue;
    const full = join(dir, name);
    let info;
    try {
      info = await stat(full);
    } catch {
      continue; // raced removal / unreadable — skip
    }
    if (!info.isFile()) continue;
    if (!best || info.mtimeMs > best.mtimeMs) {
      best = { id: name.slice(0, -'.jsonl'.length), path: full, mtimeMs: info.mtimeMs };
    }
  }
  return best;
}

/**
 * Copy `session`'s transcript into `toCwd`'s project folder so `claude --resume
 * <id>` finds it when run there. Creates the destination folder if absent and
 * returns the destination path. Overwrites any prior copy (idempotent re-runs).
 */
export async function copySessionToCwd(
  session: ClaudeSession,
  toCwd: string,
  projectsRoot: string = claudeProjectsRoot(),
): Promise<string> {
  const destDir = join(projectsRoot, encodeProjectDir(toCwd));
  await mkdir(destDir, { recursive: true });
  const dest = join(destDir, `${session.id}.jsonl`);
  await copyFile(session.path, dest);
  return dest;
}

/** The Claude adapter — thin binding of the pure functions above. */
export const claudeSessionStore: AgentSessionStore = {
  kind: 'claude',
  latestSessionForCwd: (cwd) => latestSessionForCwd(cwd),
  copySessionToCwd: (session, toCwd) =>
    copySessionToCwd({ ...session, mtimeMs: 0 }, toCwd),
};
