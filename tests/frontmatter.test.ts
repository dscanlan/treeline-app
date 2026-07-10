import { describe, expect, it } from 'vitest';
import { parseFrontmatterEntries, splitFrontmatter } from '../src/shared/frontmatter';

describe('splitFrontmatter', () => {
  it('splits a typical block off the body', () => {
    const src = '---\ntype: repo\nname: app\n---\n\n# Title\n\nBody.';
    const { yaml, body } = splitFrontmatter(src);
    expect(yaml).toBe('type: repo\nname: app');
    expect(body).toBe('\n# Title\n\nBody.');
  });

  it('preserves body content after the close fence byte-exact', () => {
    const body = '# H\n\n---\n\nrule above stays\n';
    const { body: out } = splitFrontmatter(`---\nk: v\n---\n${body}`);
    expect(out).toBe(body);
  });

  it('tolerates CRLF fences and lines', () => {
    const { yaml, body } = splitFrontmatter('---\r\ntags: [a, b]\r\n---\r\nBody');
    expect(yaml).toBe('tags: [a, b]\r');
    expect(body).toBe('Body');
    expect(parseFrontmatterEntries(yaml!)).toEqual([{ key: 'tags', value: ['a', 'b'] }]);
  });

  // Negative controls — anything that isn't a well-formed leading fence is body.
  it('returns yaml null and the source unchanged when there is no frontmatter', () => {
    const src = '# Just a doc\n\n---\n\nwith a rule';
    expect(splitFrontmatter(src)).toEqual({ yaml: null, body: src });
  });

  it('treats an opener without a closer as body', () => {
    const src = '---\nkey: value\nno close fence';
    expect(splitFrontmatter(src)).toEqual({ yaml: null, body: src });
  });

  it('does not recognise a fence after a leading blank line', () => {
    const src = '\n---\nk: v\n---\nbody';
    expect(splitFrontmatter(src)).toEqual({ yaml: null, body: src });
  });

  it('yields zero entries for an empty block', () => {
    const { yaml } = splitFrontmatter('---\n---\nbody');
    expect(yaml).toBe('');
    expect(parseFrontmatterEntries(yaml!)).toEqual([]);
  });
});

describe('parseFrontmatterEntries', () => {
  it('parses the vault-typical shape: scalars, inline arrays, dates', () => {
    const entries = parseFrontmatterEntries(
      [
        'type: repo',
        'name: treeline-app',
        'tags: [type/repo, domain/git-worktrees]',
        'documented: 2026-07-05',
        'head: 85fc3df',
      ].join('\n'),
    );
    expect(entries).toEqual([
      { key: 'type', value: 'repo' },
      { key: 'name', value: 'treeline-app' },
      { key: 'tags', value: ['type/repo', 'domain/git-worktrees'] },
      { key: 'documented', value: '2026-07-05' },
      { key: 'head', value: '85fc3df' },
    ]);
  });

  it('parses block lists into string arrays', () => {
    const entries = parseFrontmatterEntries('sources:\n  - one\n  - two\nafter: x');
    expect(entries).toEqual([
      { key: 'sources', value: ['one', 'two'] },
      { key: 'after', value: 'x' },
    ]);
  });

  it('unquotes quoted scalars and array items', () => {
    const entries = parseFrontmatterEntries('title: "Quoted: with colon"\ntags: [\'a\', "b"]');
    expect(entries).toEqual([
      { key: 'title', value: 'Quoted: with colon' },
      { key: 'tags', value: ['a', 'b'] },
    ]);
  });

  it('preserves key order and never throws on odd input', () => {
    const entries = parseFrontmatterEntries('z: 1\n  stray indent\na: 2\n:::garbage:::\n');
    expect(entries.map((e) => e.key)).toEqual(['z', 'a']);
    expect(entries[0]).toEqual({ key: 'z', value: '1 stray indent' });
  });
});
