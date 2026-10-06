import { joinPath } from './path';

export interface PathMatch {
  text: string;
  /** 0-based offset of the first character in the scanned string. */
  start: number;
}

// A markdown path token: bounded on the left by line start, whitespace, or an
// opening bracket/quote, so the tail of a URL (`https://x/README.md`) never
// matches — the web-links path owns those.
const MD_PATH_RE =
  /(?<=^|[\s([{<'"`])(?:~\/|\.{1,2}\/|\/)?[\w.@+%~-]+(?:\/[\w.@+%~-]+)*\.(?:md|markdown|mdx)(?![\w/]|\.\w)/gi;

export function findMarkdownPaths(line: string): PathMatch[] {
  const out: PathMatch[] = [];
  for (const m of line.matchAll(MD_PATH_RE)) {
    out.push({ text: m[0], start: m.index ?? 0 });
  }
  return out;
}

function normalize(abs: string): string {
  const parts: string[] = [];
  for (const seg of abs.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return `/${parts.join('/')}`;
}

/**
 * Absolute paths a printed path may refer to, most likely first. A bare
 * relative path is tried against the terminal's cwd, then home — tools often
 * print home-relative paths (`worktrees/x/report.md`) without the `~/`.
 */
export function resolveCandidates(raw: string, cwd: string, home: string): string[] {
  if (raw.startsWith('/')) return [normalize(raw)];
  if (raw.startsWith('~/')) return [normalize(joinPath(home, raw.slice(2)))];
  const out = [normalize(joinPath(cwd, raw))];
  const fromHome = normalize(joinPath(home, raw));
  if (!out.includes(fromHome)) out.push(fromHome);
  return out;
}
