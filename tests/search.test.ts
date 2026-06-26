import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listFiles, parseRgJson, searchContent } from '../src/main/search';

const require = createRequire(import.meta.url);

/** Resolve the host-arch rg binary the dev build uses. */
function rgPath(): string {
  return require.resolve(`@vscode/ripgrep-darwin-${process.arch}/bin/rg`);
}

let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'search-test-'));
  writeFileSync(join(root, 'alpha.ts'), 'export function foo() {\n  return 42;\n}\n');
  writeFileSync(join(root, 'beta.ts'), 'const bar = 1;\nconst foobar = foo();\n');
  writeFileSync(join(root, '.gitignore'), 'ignored/\n');
  mkdirSync(join(root, 'ignored'), { recursive: true });
  // A match that must be EXCLUDED because .gitignore hides this dir.
  writeFileSync(join(root, 'ignored', 'secret.ts'), 'const foo = "hidden";\n');
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('searchContent', () => {
  it('finds literal matches and reports file + line + submatch offsets', async () => {
    const res = await searchContent(rgPath(), root, 'foo');
    const files = res.results.map((r) => r.relPath).sort();
    // Negative control: the .gitignore'd file must NOT appear.
    expect(files).toEqual(['alpha.ts', 'beta.ts']);
    expect(files).not.toContain('ignored/secret.ts');

    const alpha = res.results.find((r) => r.relPath === 'alpha.ts')!;
    expect(alpha.path).toBe(join(root, 'alpha.ts'));
    expect(alpha.matches[0].line).toBe(1);
    const sm = alpha.matches[0].submatches[0];
    expect(alpha.matches[0].text.slice(sm.start, sm.end)).toBe('foo');
    expect(res.truncated).toBe(false);
  });

  it('returns nothing for a query that does not occur (negative control)', async () => {
    const res = await searchContent(rgPath(), root, 'this_string_is_nowhere');
    expect(res.results).toEqual([]);
    expect(res.totalMatches).toBe(0);
    expect(res.truncated).toBe(false);
  });

  it('treats the query literally by default but as a regex when asked', async () => {
    // "f.o" is a regex matching "foo"; literally it matches nothing here.
    const literal = await searchContent(rgPath(), root, 'f.o');
    expect(literal.totalMatches).toBe(0);

    const regex = await searchContent(rgPath(), root, 'f.o', { regex: true });
    expect(regex.totalMatches).toBeGreaterThan(0);
  });

  it('honours case sensitivity', async () => {
    const sensitive = await searchContent(rgPath(), root, 'FOO', { caseSensitive: true });
    expect(sensitive.totalMatches).toBe(0);
    // Smart-case (default) lowercases an all-lowercase query, but an uppercase
    // query stays case-sensitive — so compare against a lowercase one.
    const insensitive = await searchContent(rgPath(), root, 'foo');
    expect(insensitive.totalMatches).toBeGreaterThan(0);
  });

  it('returns an empty result for an empty query without invoking rg', async () => {
    const res = await searchContent(rgPath(), root, '');
    expect(res).toEqual({ results: [], totalMatches: 0, truncated: false });
  });
});

describe('listFiles', () => {
  it('enumerates tracked files and respects .gitignore', async () => {
    const files = (await listFiles(rgPath(), root)).sort();
    expect(files).toContain('alpha.ts');
    expect(files).toContain('beta.ts');
    expect(files).not.toContain('ignored/secret.ts');
  });
});

describe('parseRgJson', () => {
  it('converts ripgrep byte offsets to UTF-16 string indices for multibyte lines', () => {
    // "café foo" — the é is 2 bytes, so rg's byte offset for "foo" is 6, but the
    // string index is 5. The parser must convert so the renderer can slice.
    const line = 'café foo';
    const byteStart = Buffer.from('café ', 'utf8').length; // 6
    const ndjson = JSON.stringify({
      type: 'match',
      data: {
        path: { text: 'x.ts' },
        lines: { text: `${line}\n` },
        line_number: 3,
        submatches: [{ match: { text: 'foo' }, start: byteStart, end: byteStart + 3 }],
      },
    });

    const parsed = parseRgJson(ndjson, '/repo');
    const m = parsed.results[0].matches[0];
    expect(m.line).toBe(3);
    expect(m.text).toBe(line);
    const sm = m.submatches[0];
    expect(sm.start).toBe(5); // "café " is 5 UTF-16 units
    expect(line.slice(sm.start, sm.end)).toBe('foo');
    expect(parsed.results[0].path).toBe('/repo/x.ts');
  });

  it('skips non-match events and malformed lines', () => {
    const lines = [
      JSON.stringify({ type: 'begin', data: { path: { text: 'x.ts' } } }),
      'not json at all',
      JSON.stringify({ type: 'summary', data: {} }),
    ].join('\n');
    const parsed = parseRgJson(lines, '/repo');
    expect(parsed.results).toEqual([]);
    expect(parsed.totalMatches).toBe(0);
  });
});
