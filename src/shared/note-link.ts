/**
 * Pure helpers for wiki-style note links: parsing `[[wikilinks]]` out of
 * text, indexing a vault's notes by basename, and resolving link targets to
 * relative paths. Lives in `shared/` (like `fuzzy.ts`) so the node tsconfig
 * can typecheck its test — no React, no Electron, no Node imports.
 */

export interface WikilinkParts {
  /** The note name or vault-relative path, without heading or alias. */
  target: string;
  /** The `#heading` fragment, if any (without the `#`). */
  heading: string | null;
  /** The display alias after `|`, if any. */
  alias: string | null;
}

/**
 * Split the inside of a `[[...]]` into target / heading / alias. The common
 * wiki form is `target#heading|alias`; heading and alias are both optional.
 * Returns null when the target is empty (e.g. `[[]]` or `[[#h]]`).
 */
export function parseWikilinkInner(inner: string): WikilinkParts | null {
  const pipe = inner.indexOf('|');
  const alias = pipe >= 0 ? inner.slice(pipe + 1).trim() : null;
  const beforeAlias = pipe >= 0 ? inner.slice(0, pipe) : inner;
  const hash = beforeAlias.indexOf('#');
  const heading = hash >= 0 ? beforeAlias.slice(hash + 1).trim() : null;
  const target = (hash >= 0 ? beforeAlias.slice(0, hash) : beforeAlias).trim();
  if (target.length === 0) return null;
  return { target, heading: heading || null, alias: alias || null };
}

export type TextSegment =
  | { kind: 'text'; text: string }
  | { kind: 'wikilink'; parts: WikilinkParts; raw: string };

// A wikilink never spans a newline and never nests brackets.
const WIKILINK_RE = /\[\[([^[\]\n]+)\]\]/g;

/**
 * Split `text` into plain-text and wikilink segments. Unterminated `[[foo`,
 * empty `[[]]`, and newline-spanning candidates stay text. Returns a single
 * text segment when there's nothing to do.
 */
export function splitWikilinks(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let last = 0;
  WIKILINK_RE.lastIndex = 0;
  for (let m = WIKILINK_RE.exec(text); m !== null; m = WIKILINK_RE.exec(text)) {
    const parts = parseWikilinkInner(m[1]);
    if (!parts) continue; // e.g. [[#heading-only]] — leave as text
    if (m.index > last) segments.push({ kind: 'text', text: text.slice(last, m.index) });
    segments.push({ kind: 'wikilink', parts, raw: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) segments.push({ kind: 'text', text: text.slice(last) });
  if (segments.length === 0) segments.push({ kind: 'text', text });
  return segments;
}

/**
 * Wikilinks travel through react-markdown as `wikilink:` hrefs — a scheme the
 * renderer's anchor override recognises and resolves in-app. The default
 * urlTransform strips unknown protocols, so MarkdownView must whitelist this
 * one explicitly.
 */
export const WIKILINK_SCHEME = 'wikilink:';

export function wikilinkHref(parts: WikilinkParts): string {
  const target = parts.heading ? `${parts.target}#${parts.heading}` : parts.target;
  return WIKILINK_SCHEME + encodeURIComponent(target);
}

export function parseWikilinkHref(href: string): WikilinkParts | null {
  if (!href.startsWith(WIKILINK_SCHEME)) return null;
  let inner: string;
  try {
    inner = decodeURIComponent(href.slice(WIKILINK_SCHEME.length));
  } catch {
    return null;
  }
  return parseWikilinkInner(inner);
}

export interface NoteIndex {
  /** Lowercased basename (sans .md/.markdown/.mdx) → vault-relative path. */
  byBasename: Record<string, string>;
  /** Lowercased relative path (sans extension) → vault-relative path. */
  byRelPath: Record<string, string>;
}

const NOTE_EXT_RE = /\.(md|markdown|mdx)$/i;

/**
 * Build a resolution index from a vault's file listing (relative paths, as
 * returned by `search.files`). Non-markdown entries are skipped. When two
 * notes share a basename, the shortest relative path wins (lexicographic
 * tiebreak) — deterministic, matching the "shortest path" convention most
 * wiki-style note apps use.
 */
export function buildNoteIndex(relPaths: string[]): NoteIndex {
  const byBasename: Record<string, string> = {};
  const byRelPath: Record<string, string> = {};
  for (const rel of relPaths) {
    if (!NOTE_EXT_RE.test(rel)) continue;
    const relKey = rel.replace(NOTE_EXT_RE, '').toLowerCase();
    const slash = rel.lastIndexOf('/');
    const baseKey = relKey.slice(slash + 1);
    const prevRel = byRelPath[relKey];
    if (prevRel === undefined || better(rel, prevRel)) byRelPath[relKey] = rel;
    const prevBase = byBasename[baseKey];
    if (prevBase === undefined || better(rel, prevBase)) byBasename[baseKey] = rel;
  }
  return { byBasename, byRelPath };
}

function better(a: string, b: string): boolean {
  return a.length !== b.length ? a.length < b.length : a < b;
}

/**
 * Resolve a wikilink target against the index. Strips any `#heading`,
 * tolerates a trailing `.md`, and is case-insensitive. Targets containing a
 * `/` are tried as vault-relative paths first, then fall back to basename.
 * Returns the note's relative path, or null when unresolved.
 */
export function resolveNoteTarget(index: NoteIndex, target: string): string | null {
  const hash = target.indexOf('#');
  let key = (hash >= 0 ? target.slice(0, hash) : target).trim().toLowerCase();
  if (key.length === 0) return null;
  key = key.replace(NOTE_EXT_RE, '');
  if (key.includes('/')) {
    const byPath = index.byRelPath[key.replace(/^\/+/, '')];
    if (byPath) return byPath;
    const slash = key.lastIndexOf('/');
    return index.byBasename[key.slice(slash + 1)] ?? null;
  }
  return index.byBasename[key] ?? null;
}

/** Directory part of a POSIX path ('' when there is no slash). */
export function dirnamePosix(p: string): string {
  const idx = p.replace(/\/+$/, '').lastIndexOf('/');
  return idx > 0 ? p.slice(0, idx) : idx === 0 ? '/' : '';
}

/**
 * Resolve a relative markdown href (`./a.md`, `../b/c.md`, `a%20b.md`) against
 * the directory of the current file. Strips `?query`/`#fragment`, decodes
 * percent-escapes, and normalises `.`/`..` segments. Returns an absolute path,
 * or null when the href is empty or escapes above the filesystem root.
 */
export function resolveRelativeHref(baseDirAbs: string, href: string): string | null {
  let cleaned = href.split(/[?#]/, 1)[0];
  try {
    cleaned = decodeURIComponent(cleaned);
  } catch {
    return null;
  }
  if (cleaned.length === 0) return null;

  const stack = baseDirAbs.split('/').filter((s) => s.length > 0);
  for (const seg of cleaned.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (stack.length === 0) return null; // escapes above '/'
      stack.pop();
    } else {
      stack.push(seg);
    }
  }
  if (stack.length === 0) return null;
  return '/' + stack.join('/');
}
