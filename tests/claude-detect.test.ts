import { describe, expect, it } from 'vitest';
import { detectClaudeWorktree } from '../src/shared/claude-detect';

describe('detectClaudeWorktree', () => {
  it('matches paths under .claude/worktrees/', () => {
    expect(
      detectClaudeWorktree('/Users/me/code/foo/.claude/worktrees/feat-x', 'feat-x'),
    ).toBe(true);
  });

  it('matches branches starting with worktree-', () => {
    expect(detectClaudeWorktree('/tmp/wt-abc', 'worktree-abc')).toBe(true);
  });

  it('rejects regular branches at regular paths', () => {
    expect(detectClaudeWorktree('/Users/me/code/foo', 'main')).toBe(false);
    expect(detectClaudeWorktree('/Users/me/code/foo-feat', 'feat/auth')).toBe(false);
  });

  it('does not match `.claude/worktrees` only by suffix', () => {
    // Must contain the surrounding slashes — a path that *ends* with the dir
    // but no trailing slash is still a match because we have a leading slash.
    expect(detectClaudeWorktree('/x/.claude/worktrees/y', 'whatever')).toBe(true);
    // Without the leading slash, it's not a Claude worktree by path, but the
    // branch rule still applies.
    expect(detectClaudeWorktree('claude/worktrees/y', 'main')).toBe(false);
  });

  it('matches when both signals fire', () => {
    expect(
      detectClaudeWorktree('/x/.claude/worktrees/y', 'worktree-abc'),
    ).toBe(true);
  });
});
