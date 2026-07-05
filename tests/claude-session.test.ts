import { mkdtempSync, rmSync, mkdirSync, writeFileSync, utimesSync, readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  encodeProjectDir,
  latestSessionForCwd,
  copySessionToCwd,
  type ClaudeSession,
} from '../src/main/agent-sessions/claude';

// A normal conversation transcript (has an `assistant` turn).
const CONV = '{"type":"user","text":"hi"}\n{"type":"assistant","text":"yo"}\n';
// A `bridge-session` marker — written when a session continues across a model
// switch / compaction. It has no `assistant` turn but IS the valid `--resume`
// pointer to the live conversation, and carries the newest mtime right after
// the bridge. It must NOT be filtered out (doing so resumed an older session).
const BRIDGE = '{"type":"bridge-session","sessionId":"live"}\n{"type":"user"}\n';

describe('claude-session', () => {
  describe('encodeProjectDir', () => {
    it('replaces every / and . with - (matching Claude’s scheme)', () => {
      expect(encodeProjectDir('/Users/me/code/app')).toBe('-Users-me-code-app');
      expect(encodeProjectDir('/Users/me/code/app/.claude/worktrees/x')).toBe(
        '-Users-me-code-app--claude-worktrees-x',
      );
    });

    it('replaces underscores (and other non-alphanumerics) with -, like Claude does', () => {
      // Real-world regression: `/Users/me/obsidian_notes` is stored by Claude as
      // `-Users-me-obsidian-notes` (underscore → dash), not `...obsidian_notes`.
      expect(encodeProjectDir('/Users/me/obsidian_notes')).toBe('-Users-me-obsidian-notes');
      expect(encodeProjectDir('/Users/me/obsidian_notes-git-vault')).toBe(
        '-Users-me-obsidian-notes-git-vault',
      );
    });
  });

  describe('latestSessionForCwd / copySessionToCwd', () => {
    let root: string; // stands in for ~/.claude/projects
    const cwd = '/Users/me/code/app';

    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), 'treeline-claude-'));
    });
    afterEach(() => {
      rmSync(root, { recursive: true, force: true });
    });

    function seed(name: string, body: string, mtimeSec: number): string {
      const dir = join(root, encodeProjectDir(cwd));
      mkdirSync(dir, { recursive: true });
      const p = join(dir, name);
      writeFileSync(p, body);
      utimesSync(p, mtimeSec, mtimeSec);
      return p;
    }

    it('returns null when the cwd has no project folder', async () => {
      expect(await latestSessionForCwd(cwd, root)).toBeNull();
    });

    it('picks the newest .jsonl by mtime and strips the extension for the id', async () => {
      seed('old.jsonl', CONV, 1000);
      seed('new.jsonl', CONV, 2000);
      const s = await latestSessionForCwd(cwd, root);
      expect(s?.id).toBe('new');
      expect(s?.path).toBe(join(root, encodeProjectDir(cwd), 'new.jsonl'));
    });

    it('ignores non-jsonl files', async () => {
      seed('notes.txt', 'x', 5000);
      seed('a-real-session.jsonl', CONV, 1000);
      const s = await latestSessionForCwd(cwd, root);
      expect(s?.id).toBe('a-real-session');
    });

    it('picks a newer bridge-session over an older conversation (the live --resume pointer)', async () => {
      // Regression guard: a `bridge-session` marker has no `assistant` turn but
      // is the newest file and the correct resume target for the conversation
      // the user is in. Filtering it out resumed the older transcript instead —
      // the worktree-handoff "wrong/older session" bug. Newest mtime wins.
      seed('older-real.jsonl', CONV, 2000);
      seed('newer-bridge.jsonl', BRIDGE, 9000);
      const s = await latestSessionForCwd(cwd, root);
      expect(s?.id).toBe('newer-bridge');
    });

    it('copies the transcript into the destination cwd’s folder, creating it', async () => {
      seed('sess.jsonl', CONV, 1000);
      const session = (await latestSessionForCwd(cwd, root)) as ClaudeSession;
      const toCwd = '/Users/me/code/app/.claude/worktrees/feat';

      const dest = await copySessionToCwd(session, toCwd, root);

      expect(dest).toBe(join(root, encodeProjectDir(toCwd), 'sess.jsonl'));
      expect(existsSync(dest)).toBe(true);
      expect(readFileSync(dest, 'utf8')).toBe(CONV);
      // The copy is itself a resumable session in the destination folder.
      const resumable = await latestSessionForCwd(toCwd, root);
      expect(resumable?.id).toBe('sess');
    });
  });
});
