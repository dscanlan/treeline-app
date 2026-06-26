/**
 * Tiny fuzzy subsequence matcher for the ⌘P quick-open list. Pure and
 * dependency-free (no fuse.js): the candidate set is one worktree's file list,
 * already bounded by ripgrep, so a linear scan per keystroke is plenty fast.
 * Lives in `shared/` (like `pane-tree.ts`) so the node tsconfig can typecheck
 * its test.
 *
 * Scoring favours, in order: a contiguous run of matched chars, matches right
 * after a path separator or word boundary, and matches near the start. Greedy
 * (takes the first matching char), so alignment isn't always optimal — fine for
 * a quick-open over one worktree. Returns the matched character indices so the
 * caller can bold them.
 */
export interface FuzzyMatch {
  score: number;
  /** Indices into the candidate string that matched, ascending. */
  indices: number[];
}

const SEPARATORS = new Set(['/', '\\', '_', '-', '.', ' ']);

/**
 * Score `query` against `candidate` (case-insensitive). Returns null when
 * `query` is not a subsequence of `candidate`. An empty query matches with a
 * neutral score and no highlights.
 */
export function fuzzyScore(query: string, candidate: string): FuzzyMatch | null {
  if (query.length === 0) return { score: 0, indices: [] };
  if (query.length > candidate.length) return null;

  const q = query.toLowerCase();
  const c = candidate.toLowerCase();
  const indices: number[] = [];

  let score = 0;
  let ci = 0;
  let prevMatch = -2; // so the first match is never counted as "consecutive"

  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi];
    let found = -1;
    for (; ci < c.length; ci++) {
      if (c[ci] === ch) {
        found = ci;
        break;
      }
    }
    if (found === -1) return null; // ran out of candidate — not a subsequence

    let bonus = 1;
    if (found === prevMatch + 1) bonus += 8; // consecutive run
    if (found === 0 || SEPARATORS.has(candidate[found - 1])) bonus += 6; // boundary
    // Cheap distance penalty so earlier matches edge out later ones.
    score += bonus - found * 0.01;

    indices.push(found);
    prevMatch = found;
    ci = found + 1;
  }

  // Nudge basename matches above deep-path matches: a hit in the last segment
  // (after the final separator) is usually what the user means.
  const lastSep = Math.max(candidate.lastIndexOf('/'), candidate.lastIndexOf('\\'));
  if (indices[0] > lastSep) score += 4;

  return { score, indices };
}

export interface ScoredItem<T> {
  item: T;
  match: FuzzyMatch;
}

/**
 * Filter + rank `items` by `query` against the string from `key`. Stable for
 * equal scores (preserves input order, so an empty query returns items as-is),
 * and capped at `limit` to keep rendering cheap.
 */
export function fuzzyFilter<T>(
  items: T[],
  query: string,
  key: (item: T) => string,
  limit = 200,
): ScoredItem<T>[] {
  const scored: { item: T; match: FuzzyMatch; order: number }[] = [];
  for (let i = 0; i < items.length; i++) {
    const match = fuzzyScore(query, key(items[i]));
    if (match) scored.push({ item: items[i], match, order: i });
  }
  scored.sort((a, b) => b.match.score - a.match.score || a.order - b.order);
  return scored.slice(0, limit).map(({ item, match }) => ({ item, match }));
}
