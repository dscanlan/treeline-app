/**
 * Minimal, tolerant YAML-frontmatter handling for the markdown preview: split
 * the leading `---` fence off a note and parse it into displayable key/value
 * entries. This is a display-only parser, not YAML — it covers the shapes that
 * actually appear in note frontmatter (scalars, inline `[a, b]` arrays, block
 * lists) and never throws on dirty input. Pure and dependency-free so the node
 * tsconfig can typecheck its test.
 */

export interface FrontmatterEntry {
  key: string;
  value: string | string[];
}

const FENCE_RE = /^---\r?$/;

/**
 * Split a leading frontmatter block off `source`. Only recognised when the
 * very first line is exactly `---` (CRLF tolerated) and a closing `---` line
 * exists; otherwise the whole source is body, byte-identical.
 */
export function splitFrontmatter(source: string): { yaml: string | null; body: string } {
  const lines = source.split('\n');
  if (lines.length < 2 || !FENCE_RE.test(lines[0])) return { yaml: null, body: source };
  for (let i = 1; i < lines.length; i++) {
    if (FENCE_RE.test(lines[i])) {
      return {
        yaml: lines.slice(1, i).join('\n'),
        body: lines.slice(i + 1).join('\n'),
      };
    }
  }
  return { yaml: null, body: source }; // opener without closer — not frontmatter
}

const KEY_RE = /^([A-Za-z0-9_.-]+):(.*)$/;
const LIST_ITEM_RE = /^\s+-\s*(.*)$/;

/**
 * Parse a frontmatter block into ordered entries. Handles `key: value`,
 * inline arrays `key: [a, b]`, and block lists (`key:` followed by indented
 * `- item` lines). Indented continuation lines under a scalar fold into an
 * array with the scalar. Unparseable lines are skipped. Never throws.
 */
export function parseFrontmatterEntries(yaml: string): FrontmatterEntry[] {
  const entries: FrontmatterEntry[] = [];
  let current: FrontmatterEntry | null = null;

  for (const rawLine of yaml.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (line.trim().length === 0) continue;

    const keyMatch = /^\S/.test(line) ? KEY_RE.exec(line) : null;
    if (keyMatch) {
      const key = keyMatch[1];
      const rest = keyMatch[2].trim();
      if (rest.length === 0) {
        current = { key, value: [] }; // expect a block list to follow
      } else if (rest.startsWith('[') && rest.endsWith(']')) {
        const items = rest
          .slice(1, -1)
          .split(',')
          .map((s) => unquote(s.trim()))
          .filter((s) => s.length > 0);
        current = { key, value: items };
      } else {
        current = { key, value: unquote(rest) };
      }
      entries.push(current);
      continue;
    }

    const item = LIST_ITEM_RE.exec(line);
    if (item && current) {
      const text = unquote(item[1].trim());
      if (Array.isArray(current.value)) current.value.push(text);
      else current.value = [current.value, text];
      continue;
    }

    // Other indented continuation (e.g. folded text) — append to the entry.
    if (current) {
      const text = line.trim();
      if (Array.isArray(current.value)) current.value.push(text);
      else current.value = `${current.value} ${text}`;
    }
  }

  return entries;
}

function unquote(s: string): string {
  if (s.length >= 2 && ((s[0] === '"' && s.endsWith('"')) || (s[0] === "'" && s.endsWith("'")))) {
    return s.slice(1, -1);
  }
  return s;
}
