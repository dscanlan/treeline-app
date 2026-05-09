import { describe, expect, it } from 'vitest';
import { parseWorktreePorcelain } from '../src/main/git-porcelain';

describe('parseWorktreePorcelain', () => {
  it('parses a single normal worktree', () => {
    const text = [
      'worktree /Users/me/code/foo',
      'HEAD abcdef0123456789',
      'branch refs/heads/main',
      '',
    ].join('\n');

    expect(parseWorktreePorcelain(text)).toEqual([
      { path: '/Users/me/code/foo', branch: 'main', commit: 'abcdef0', isBare: false },
    ]);
  });

  it('parses multiple worktrees separated by blank lines', () => {
    const text = [
      'worktree /code/foo',
      'HEAD aaaaaaa0000',
      'branch refs/heads/main',
      '',
      'worktree /code/foo-feat',
      'HEAD bbbbbbb0000',
      'branch refs/heads/feat/auth',
      '',
    ].join('\n');

    const result = parseWorktreePorcelain(text);
    expect(result).toHaveLength(2);
    expect(result[0]?.branch).toBe('main');
    expect(result[1]?.branch).toBe('feat/auth');
  });

  it('handles a final entry with no trailing blank line', () => {
    const text = [
      'worktree /code/foo',
      'HEAD aaaaaaa0000',
      'branch refs/heads/main',
    ].join('\n');

    const result = parseWorktreePorcelain(text);
    expect(result).toHaveLength(1);
    expect(result[0]?.path).toBe('/code/foo');
  });

  it('marks bare repos with branch "(bare)"', () => {
    const text = ['worktree /code/foo.git', 'bare', ''].join('\n');

    const result = parseWorktreePorcelain(text);
    expect(result).toEqual([
      { path: '/code/foo.git', branch: '(bare)', commit: '', isBare: true },
    ]);
  });

  it('marks detached HEAD with branch "(detached)"', () => {
    const text = [
      'worktree /code/foo-detached',
      'HEAD 1234567abcd',
      'detached',
      '',
    ].join('\n');

    const result = parseWorktreePorcelain(text);
    expect(result[0]?.branch).toBe('(detached)');
    expect(result[0]?.isBare).toBe(false);
    expect(result[0]?.commit).toBe('1234567');
  });

  it('handles short SHAs gracefully (commit < 7 chars)', () => {
    const text = ['worktree /code/foo', 'HEAD abc', 'branch refs/heads/main', ''].join(
      '\n',
    );
    expect(parseWorktreePorcelain(text)[0]?.commit).toBe('abc');
  });

  it('ignores unknown porcelain keys (locked, prunable, etc.)', () => {
    const text = [
      'worktree /code/foo',
      'HEAD abcdef01234',
      'branch refs/heads/main',
      'locked',
      'prunable gitdir file points to non-existent location',
      '',
    ].join('\n');

    const result = parseWorktreePorcelain(text);
    expect(result).toHaveLength(1);
    expect(result[0]?.branch).toBe('main');
  });

  it('parses Claude-style branches (worktree-*) without special-casing them', () => {
    // Detection happens later in detectClaudeWorktree — the parser just reads.
    const text = [
      'worktree /code/foo/.claude/worktrees/feat',
      'HEAD ababab012345',
      'branch refs/heads/worktree-feat-x',
      '',
    ].join('\n');

    const result = parseWorktreePorcelain(text);
    expect(result[0]?.branch).toBe('worktree-feat-x');
    expect(result[0]?.path).toBe('/code/foo/.claude/worktrees/feat');
  });

  it('returns [] for empty input', () => {
    expect(parseWorktreePorcelain('')).toEqual([]);
  });

  it('flushes the previous record if a new `worktree` line arrives without a blank separator', () => {
    // Defensive: real git always emits a blank line between records, but we
    // shouldn't lose data if it doesn't.
    const text = [
      'worktree /code/a',
      'HEAD aaaaaaa0000',
      'branch refs/heads/main',
      'worktree /code/b',
      'HEAD bbbbbbb0000',
      'branch refs/heads/feat',
    ].join('\n');

    const result = parseWorktreePorcelain(text);
    expect(result).toHaveLength(2);
    expect(result[0]?.path).toBe('/code/a');
    expect(result[1]?.path).toBe('/code/b');
  });
});
