import { describe, expect, it } from 'vitest';
import {
  buildNoteIndex,
  dirnamePosix,
  parseWikilinkHref,
  parseWikilinkInner,
  resolveNoteTarget,
  resolveRelativeHref,
  splitWikilinks,
  wikilinkHref,
} from '../src/shared/note-link';

describe('parseWikilinkInner', () => {
  it('parses a bare target', () => {
    expect(parseWikilinkInner('note')).toEqual({ target: 'note', heading: null, alias: null });
  });

  it('parses target#heading|alias', () => {
    expect(parseWikilinkInner('note#Setup|the setup doc')).toEqual({
      target: 'note',
      heading: 'Setup',
      alias: 'the setup doc',
    });
  });

  it('returns null for an empty or heading-only target', () => {
    expect(parseWikilinkInner('')).toBeNull();
    expect(parseWikilinkInner('   ')).toBeNull();
    expect(parseWikilinkInner('#heading')).toBeNull();
  });
});

describe('splitWikilinks', () => {
  it('passes plain text through as one segment', () => {
    expect(splitWikilinks('no links here')).toEqual([{ kind: 'text', text: 'no links here' }]);
  });

  it('splits a single wikilink with surrounding text', () => {
    const segs = splitWikilinks('see [[note]] for more');
    expect(segs).toHaveLength(3);
    expect(segs[0]).toEqual({ kind: 'text', text: 'see ' });
    expect(segs[1]).toMatchObject({ kind: 'wikilink', parts: { target: 'note' }, raw: '[[note]]' });
    expect(segs[2]).toEqual({ kind: 'text', text: ' for more' });
  });

  it('handles alias and heading forms', () => {
    const segs = splitWikilinks('[[a|Alias]] and [[b#Head]]');
    expect(segs[0]).toMatchObject({ kind: 'wikilink', parts: { target: 'a', alias: 'Alias' } });
    expect(segs[2]).toMatchObject({ kind: 'wikilink', parts: { target: 'b', heading: 'Head' } });
  });

  it('splits two links in one string with interleaved text', () => {
    const segs = splitWikilinks('x [[a]] y [[b]] z');
    expect(segs.map((s) => s.kind)).toEqual(['text', 'wikilink', 'text', 'wikilink', 'text']);
  });

  // Negative controls: malformed candidates must stay literal text.
  it('leaves unterminated, empty, and newline-spanning candidates as text', () => {
    expect(splitWikilinks('[[foo')).toEqual([{ kind: 'text', text: '[[foo' }]);
    expect(splitWikilinks('[[]]')).toEqual([{ kind: 'text', text: '[[]]' }]);
    expect(splitWikilinks('[[a\nb]]')).toEqual([{ kind: 'text', text: '[[a\nb]]' }]);
  });
});

describe('wikilinkHref / parseWikilinkHref', () => {
  it('round-trips target and heading', () => {
    const href = wikilinkHref({ target: 'my note', heading: 'A B', alias: 'x' });
    expect(href.startsWith('wikilink:')).toBe(true);
    expect(parseWikilinkHref(href)).toEqual({ target: 'my note', heading: 'A B', alias: null });
  });

  it('returns null for non-wikilink hrefs and bad escapes', () => {
    expect(parseWikilinkHref('https://example.com')).toBeNull();
    expect(parseWikilinkHref('wikilink:%')).toBeNull();
  });
});

describe('buildNoteIndex', () => {
  it('indexes markdown only, case-insensitively', () => {
    const idx = buildNoteIndex(['A/Note.md', 'b/image.png', 'c/other.markdown']);
    expect(idx.byBasename['note']).toBe('A/Note.md');
    expect(idx.byBasename['other']).toBe('c/other.markdown');
    expect(idx.byBasename['image']).toBeUndefined();
    expect(idx.byRelPath['a/note']).toBe('A/Note.md');
  });

  it('prefers the shortest relPath on duplicate basenames, lexicographic tiebreak', () => {
    const idx = buildNoteIndex(['deep/nested/dup.md', 'top/dup.md', 'ttp/dup.md']);
    expect(idx.byBasename['dup']).toBe('top/dup.md');
  });
});

describe('resolveNoteTarget', () => {
  const idx = buildNoteIndex(['Code/app/app.md', 'Ideas/roadmap.md', 'inbox.md']);

  it('resolves by basename, stripping heading and tolerating .md', () => {
    expect(resolveNoteTarget(idx, 'roadmap')).toBe('Ideas/roadmap.md');
    expect(resolveNoteTarget(idx, 'Roadmap#Next')).toBe('Ideas/roadmap.md');
    expect(resolveNoteTarget(idx, 'roadmap.md')).toBe('Ideas/roadmap.md');
    expect(resolveNoteTarget(idx, 'inbox')).toBe('inbox.md');
  });

  it('resolves path-form targets via relPath first, basename fallback', () => {
    expect(resolveNoteTarget(idx, 'Code/app/app')).toBe('Code/app/app.md');
    expect(resolveNoteTarget(idx, 'wrong/dir/roadmap')).toBe('Ideas/roadmap.md');
  });

  it('returns null on a miss', () => {
    expect(resolveNoteTarget(idx, 'no-such-note')).toBeNull();
    expect(resolveNoteTarget(idx, '')).toBeNull();
  });
});

describe('dirnamePosix / resolveRelativeHref', () => {
  it('extracts the directory part', () => {
    expect(dirnamePosix('/a/b/c.md')).toBe('/a/b');
    expect(dirnamePosix('/a.md')).toBe('/');
    expect(dirnamePosix('a.md')).toBe('');
  });

  it('resolves ./, ../, encoded, and query/fragment-carrying hrefs', () => {
    expect(resolveRelativeHref('/v/notes', './a.md')).toBe('/v/notes/a.md');
    expect(resolveRelativeHref('/v/notes', '../a.md')).toBe('/v/a.md');
    expect(resolveRelativeHref('/v/notes', 'a%20b.md')).toBe('/v/notes/a b.md');
    expect(resolveRelativeHref('/v/notes', 'a.md?x=1#frag')).toBe('/v/notes/a.md');
    expect(resolveRelativeHref('/v/notes', 'sub/dir/a.md')).toBe('/v/notes/sub/dir/a.md');
  });

  it('returns null when the href is empty or escapes above the root', () => {
    expect(resolveRelativeHref('/v', '')).toBeNull();
    expect(resolveRelativeHref('/v', '../../../a.md')).toBeNull();
    expect(resolveRelativeHref('/v', '%')).toBeNull();
  });
});
