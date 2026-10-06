import { describe, expect, it } from 'vitest';
import {
  findMarkdownPaths,
  resolveCandidates,
} from '../src/renderer/util/terminal-file-links';

const texts = (line: string) => findMarkdownPaths(line).map((m) => m.text);

describe('findMarkdownPaths', () => {
  it('finds a parenthesised relative path with its offset', () => {
    const line =
      'Markdown report (worktrees/citadel-pr-review-oct05/.agent-tmp/final-pr-review-oct06/final-review.md)';
    const [m] = findMarkdownPaths(line);
    expect(m.text).toBe(
      'worktrees/citadel-pr-review-oct05/.agent-tmp/final-pr-review-oct06/final-review.md',
    );
    expect(m.start).toBe(line.indexOf('worktrees'));
  });

  it('handles absolute, home, dot-relative and bare names', () => {
    expect(texts('a /Users/me/x.md b ~/notes/y.MD c ./z.markdown d ../up/w.mdx e README.md')).toEqual(
      ['/Users/me/x.md', '~/notes/y.MD', './z.markdown', '../up/w.mdx', 'README.md'],
    );
  });

  it('stops before trailing punctuation', () => {
    expect(texts('wrote `docs/plan.md`, then "a.md".')).toEqual(['docs/plan.md', 'a.md']);
  });

  it('ignores URLs, other extensions and md-prefixed extensions', () => {
    expect(texts('https://github.com/o/r/blob/main/README.md')).toEqual([]);
    expect(texts('notes.txt main.rs file.md.bak foo.mdown')).toEqual([]);
  });
});

describe('resolveCandidates', () => {
  const cwd = '/Users/me/code/app';
  const home = '/Users/me';

  it('keeps absolute paths, normalised', () => {
    expect(resolveCandidates('/a/./b/../c.md', cwd, home)).toEqual(['/a/c.md']);
  });

  it('expands ~/', () => {
    expect(resolveCandidates('~/notes/x.md', cwd, home)).toEqual(['/Users/me/notes/x.md']);
  });

  it('tries cwd then home for bare relative paths', () => {
    expect(resolveCandidates('worktrees/r.md', cwd, home)).toEqual([
      '/Users/me/code/app/worktrees/r.md',
      '/Users/me/worktrees/r.md',
    ]);
    expect(resolveCandidates('../x.md', cwd, home)).toEqual([
      '/Users/me/code/x.md',
      '/Users/x.md',
    ]);
  });

  it('dedupes when cwd is home', () => {
    expect(resolveCandidates('a.md', home, home)).toEqual(['/Users/me/a.md']);
  });
});
