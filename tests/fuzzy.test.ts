import { describe, expect, it } from 'vitest';
import { fuzzyScore, fuzzyFilter } from '../src/shared/fuzzy';

describe('fuzzyScore', () => {
  it('matches a subsequence and reports the matched indices', () => {
    const m = fuzzyScore('ace', 'abcde');
    expect(m).not.toBeNull();
    expect(m!.indices).toEqual([0, 2, 4]);
  });

  it('returns null when the query is not a subsequence', () => {
    expect(fuzzyScore('xyz', 'abcde')).toBeNull();
    expect(fuzzyScore('eca', 'abcde')).toBeNull(); // order matters
  });

  it('matches an empty query with no highlights', () => {
    expect(fuzzyScore('', 'anything')).toEqual({ score: 0, indices: [] });
  });

  it('scores a segment-boundary match above the same letter mid-token', () => {
    // "s" sits at a path-segment start in "a/store.ts" (right after the `/`) but
    // is buried mid-word in "tabs.ts"; the boundary hit should rank higher.
    const boundary = fuzzyScore('s', 'a/store.ts')!;
    const midToken = fuzzyScore('s', 'tabs.ts')!;
    expect(boundary).not.toBeNull();
    expect(midToken).not.toBeNull();
    expect(boundary.score).toBeGreaterThan(midToken.score);
  });

  it('scores a contiguous run above a broken one', () => {
    const contiguous = fuzzyScore('foo', 'foobar')!;
    const broken = fuzzyScore('foo', 'f_o_o_bar')!;
    expect(contiguous.score).toBeGreaterThan(broken.score);
  });
});

describe('fuzzyFilter', () => {
  const files = ['src/main/git.ts', 'src/main/ipc/files.ts', 'README.md', 'src/renderer/store.ts'];

  it('ranks the best match first', () => {
    const out = fuzzyFilter(files, 'files', (f) => f);
    expect(out[0].item).toBe('src/main/ipc/files.ts');
  });

  it('drops non-matching items', () => {
    const out = fuzzyFilter(files, 'zzz', (f) => f);
    expect(out).toEqual([]);
  });

  it('returns items in order for an empty query and honours the limit', () => {
    const out = fuzzyFilter(files, '', (f) => f, 2);
    expect(out.map((o) => o.item)).toEqual(['src/main/git.ts', 'src/main/ipc/files.ts']);
  });
});
