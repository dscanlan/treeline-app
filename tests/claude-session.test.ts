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
} from '../src/main/claude-session';

describe('claude-session', () => {
  describe('encodeProjectDir', () => {
    it('replaces every / and . with - (matching Claude’s scheme)', () => {
      expect(encodeProjectDir('/Users/me/code/app')).toBe('-Users-me-code-app');
      expect(encodeProjectDir('/Users/me/code/app/.claude/worktrees/x')).toBe(
        '-Users-me-code-app--claude-worktrees-x',
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
      seed('old.jsonl', 'old', 1000);
      seed('new.jsonl', 'new', 2000);
      const s = await latestSessionForCwd(cwd, root);
      expect(s?.id).toBe('new');
      expect(s?.path).toBe(join(root, encodeProjectDir(cwd), 'new.jsonl'));
    });

    it('ignores non-jsonl files', async () => {
      seed('notes.txt', 'x', 5000);
      seed('a-real-session.jsonl', 'transcript', 1000);
      const s = await latestSessionForCwd(cwd, root);
      expect(s?.id).toBe('a-real-session');
    });

    it('copies the transcript into the destination cwd’s folder, creating it', async () => {
      seed('sess.jsonl', 'transcript-bytes', 1000);
      const session = (await latestSessionForCwd(cwd, root)) as ClaudeSession;
      const toCwd = '/Users/me/code/app/.claude/worktrees/feat';

      const dest = await copySessionToCwd(session, toCwd, root);

      expect(dest).toBe(join(root, encodeProjectDir(toCwd), 'sess.jsonl'));
      expect(existsSync(dest)).toBe(true);
      expect(readFileSync(dest, 'utf8')).toBe('transcript-bytes');
      // The copy is itself a resumable session in the destination folder.
      const resumable = await latestSessionForCwd(toCwd, root);
      expect(resumable?.id).toBe('sess');
    });
  });
});
