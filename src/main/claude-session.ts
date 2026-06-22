import { mkdir, readdir, stat, copyFile, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

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
 * IPC layer in ipc/claude-session.ts resolves the origin repo and calls in.
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
 * True when a transcript is a *resumable conversation* — it contains at least
 * one assistant turn. Claude also writes non-conversation `.jsonl` stubs into a
 * project folder (e.g. a `bridge-session`/`/model` marker has `user`, `mode` and
 * `bridge-session` lines but no `assistant` reply); these often have the NEWEST
 * mtime, so a naive "newest wins" pick resumes a blank session. Note real
 * conversations contain `bridge-session` lines too, so the discriminator is the
 * presence of an `assistant` entry, not the absence of `bridge-session`.
 */
async function isResumableTranscript(path: string): Promise<boolean> {
  try {
    const text = await readFile(path, 'utf8');
    return text.includes('"type":"assistant"');
  } catch {
    return false; // raced removal / unreadable
  }
}

/**
 * The most-recently-modified *resumable* Claude transcript for `cwd`, or null
 * when that directory has no resumable session. "Newest mtime" is the heuristic
 * for "the live session" — when an agent in a repo's main checkout spins up a
 * worktree, the conversation that did so is, in practice, the most recently
 * written one for that directory — but we skip non-conversation stubs (see
 * {@link isResumableTranscript}) by scanning newest-first and returning the
 * first transcript with an assistant turn. Resolving a stub as "the session" is
 * what made `claude --resume` open a blank conversation.
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

  // All transcripts with their mtimes, newest first.
  const candidates: ClaudeSession[] = [];
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
    candidates.push({ id: name.slice(0, -'.jsonl'.length), path: full, mtimeMs: info.mtimeMs });
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);

  // Return the newest transcript that is an actual conversation, skipping stubs.
  for (const c of candidates) {
    if (await isResumableTranscript(c.path)) return c;
  }
  return null;
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
