// Pure pane-tree model + operations — no React, no store, no IO.
//
// A tab no longer hosts a single PTY; it hosts a *tree* of terminal panes. A
// leaf is one PTY (its own xterm, status dot, process badge); a split arranges
// its children along one axis ('h' = side-by-side / split-right, 'v' =
// stacked / split-down) with proportional `sizes`. These ops are the cmux-style
// splice/wrap/collapse primitives the renderer and the tabs slice build on.
//
// Lives in `shared/` (like `changed-poll.ts` / `browser-url.ts`) so the node
// tsconfig can typecheck `tests/pane-tree.test.ts` — tests only get the
// `@shared` alias, not `@/`.

import type { TabStatus } from './types';

/** 'h' splits the focused pane to the **right**; 'v' splits it **down**. */
export type SplitDirection = 'h' | 'v';

/** One terminal pane: a single PTY with its own status + process metadata. */
export interface PaneLeaf {
  kind: 'leaf';
  id: string;
  ptyId: string;
  cwd: string;
  title: string;
  status: TabStatus;
  /** Basename of the foreground child if status === 'running'. */
  foregroundCmd: string | null;
  createdAt: number;
}

/** An internal split node: children laid out along `direction`. */
export interface PaneSplit {
  kind: 'split';
  id: string;
  direction: SplitDirection;
  children: PaneNode[];
  /** Fractional sizes, parallel to `children`; always sums to ~1. */
  sizes: number[];
}

export type PaneNode = PaneLeaf | PaneSplit;

/** Directional focus move targets, matching the four arrow keys. */
export type FocusDir = 'left' | 'right' | 'up' | 'down';

let idCounter = 0;

/**
 * Generate a unique id for tree nodes. Uses `crypto.randomUUID` when available
 * (renderer + modern node) and falls back to a monotonic counter otherwise so
 * the module stays dependency-free and test-friendly.
 */
export function makeNodeId(prefix = 'node'): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
}

/** Build a fresh leaf around a freshly-spawned PTY. */
export function makeLeaf(input: {
  ptyId: string;
  cwd: string;
  title: string;
  id?: string;
  status?: TabStatus;
  foregroundCmd?: string | null;
  createdAt?: number;
}): PaneLeaf {
  return {
    kind: 'leaf',
    id: input.id ?? makeNodeId('pane'),
    ptyId: input.ptyId,
    cwd: input.cwd,
    title: input.title,
    status: input.status ?? 'idle',
    foregroundCmd: input.foregroundCmd ?? null,
    createdAt: input.createdAt ?? Date.now(),
  };
}

/** All leaves in document (left-to-right / top-to-bottom) order. */
export function leaves(node: PaneNode): PaneLeaf[] {
  if (node.kind === 'leaf') return [node];
  return node.children.flatMap(leaves);
}

/** Every ptyId under `node`, in leaf order. */
export function ptyIds(node: PaneNode): string[] {
  return leaves(node).map((l) => l.ptyId);
}

/** Find a leaf by its pane id, or null. */
export function findLeaf(node: PaneNode, id: string): PaneLeaf | null {
  if (node.kind === 'leaf') return node.id === id ? node : null;
  for (const child of node.children) {
    const hit = findLeaf(child, id);
    if (hit) return hit;
  }
  return null;
}

/** Find a leaf by the PTY it hosts, or null. */
export function findLeafByPty(node: PaneNode, ptyId: string): PaneLeaf | null {
  if (node.kind === 'leaf') return node.ptyId === ptyId ? node : null;
  for (const child of node.children) {
    const hit = findLeafByPty(child, ptyId);
    if (hit) return hit;
  }
  return null;
}

/**
 * Apply `fn` to every leaf, returning a new tree (structurally shared where a
 * subtree is unchanged-by-reference is *not* guaranteed — callers should treat
 * the result as a fresh immutable tree). Splits are copied with new arrays.
 */
export function mapLeaves(node: PaneNode, fn: (leaf: PaneLeaf) => PaneLeaf): PaneNode {
  if (node.kind === 'leaf') return fn(node);
  return { ...node, children: node.children.map((c) => mapLeaves(c, fn)), sizes: [...node.sizes] };
}

/** Even fractional sizes for `n` children. */
function evenSizes(n: number): number[] {
  return Array.from({ length: n }, () => 1 / n);
}

/**
 * Return a new tree where the split node `splitId` has its `sizes` replaced.
 * Sizes are normalised to sum to 1 and the array length is ignored if it
 * doesn't match the child count (the caller is trusted to pass a parallel
 * array). No-op clone if `splitId` isn't found.
 */
export function setSizes(node: PaneNode, splitId: string, sizes: number[]): PaneNode {
  if (node.kind === 'leaf') return node;
  if (node.id === splitId) {
    const total = sizes.reduce((a, b) => a + b, 0) || 1;
    return { ...node, sizes: sizes.map((s) => s / total) };
  }
  return { ...node, children: node.children.map((c) => setSizes(c, splitId, sizes)) };
}

/** The axis a direction lays its children out on: 'h' is horizontal. */
function axisOf(direction: SplitDirection): 'x' | 'y' {
  return direction === 'h' ? 'x' : 'y';
}

/**
 * Split the focused leaf, inserting `newLeaf` after it. cmux-style:
 *
 * - If the focused leaf's parent split is already on the same axis as `dir`,
 *   splice the new leaf in next to it and re-even that split's sizes.
 * - Otherwise wrap the focused leaf in a fresh 2-child split of `dir`.
 *
 * Returns a new root. If `focusedId` isn't found, the root is returned
 * unchanged (callers treat that as a no-op).
 */
export function splitPane(
  root: PaneNode,
  focusedId: string,
  dir: SplitDirection,
  newLeaf: PaneLeaf,
): PaneNode {
  const wrap = (leaf: PaneLeaf): PaneSplit => ({
    kind: 'split',
    id: makeNodeId('split'),
    direction: dir,
    children: [leaf, newLeaf],
    sizes: evenSizes(2),
  });

  // Root itself is the focused leaf: wrap it.
  if (root.kind === 'leaf') {
    return root.id === focusedId ? wrap(root) : root;
  }

  // Walk down; when a split directly contains the focused leaf, either splice
  // (same axis) or wrap the child in place (cross axis).
  const recur = (node: PaneSplit): PaneSplit => {
    const idx = node.children.findIndex((c) => c.kind === 'leaf' && c.id === focusedId);
    if (idx !== -1) {
      if (axisOf(node.direction) === axisOf(dir)) {
        const children = [...node.children];
        children.splice(idx + 1, 0, newLeaf);
        return { ...node, children, sizes: evenSizes(children.length) };
      }
      const children = [...node.children];
      children[idx] = wrap(node.children[idx] as PaneLeaf);
      return { ...node, children, sizes: [...node.sizes] };
    }
    // Recurse into child splits.
    const children = node.children.map((c) => (c.kind === 'split' ? recur(c) : c));
    return { ...node, children, sizes: [...node.sizes] };
  };

  return recur(root);
}

/**
 * Remove the leaf `id` from the tree. Splits that drop to a single child are
 * collapsed into that child (recursively). Returns the new root, or `null` when
 * removing the last leaf empties the tab.
 */
export function removePane(root: PaneNode, id: string): PaneNode | null {
  if (root.kind === 'leaf') return root.id === id ? null : root;

  const strip = (node: PaneNode): PaneNode | null => {
    if (node.kind === 'leaf') return node.id === id ? null : node;
    const kept: PaneNode[] = [];
    const sizes: number[] = [];
    node.children.forEach((c, i) => {
      const next = strip(c);
      if (next) {
        kept.push(next);
        sizes.push(node.sizes[i] ?? 1 / node.children.length);
      }
    });
    if (kept.length === 0) return null;
    if (kept.length === 1) return kept[0]; // collapse single-child split
    // Renormalise sizes over the survivors.
    const total = sizes.reduce((a, b) => a + b, 0) || 1;
    return { ...node, children: kept, sizes: sizes.map((s) => s / total) };
  };

  return strip(root);
}

/**
 * Pick the pane to focus after `removedId` is removed from `root` (the
 * *original* tree, before removal): prefer the leaf immediately after the
 * removed one in document order, else the one before, else null.
 */
export function focusAfterRemoval(root: PaneNode, removedId: string): string | null {
  const order = leaves(root);
  const idx = order.findIndex((l) => l.id === removedId);
  if (idx === -1) return order[0]?.id ?? null;
  return order[idx + 1]?.id ?? order[idx - 1]?.id ?? null;
}

// ── Directional focus ────────────────────────────────────────────────────
// We model each leaf's screen rectangle in normalised [0,1]² space by walking
// the tree, multiplying sizes along the way. Directional focus then picks the
// nearest leaf whose rectangle lies on the requested side and overlaps the
// focused leaf on the perpendicular axis.

interface Rect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

function layout(node: PaneNode, x: number, y: number, w: number, h: number, out: Rect[]): void {
  if (node.kind === 'leaf') {
    out.push({ id: node.id, x, y, w, h });
    return;
  }
  if (node.direction === 'h') {
    let cx = x;
    node.children.forEach((c, i) => {
      const cw = w * (node.sizes[i] ?? 1 / node.children.length);
      layout(c, cx, y, cw, h, out);
      cx += cw;
    });
  } else {
    let cy = y;
    node.children.forEach((c, i) => {
      const ch = h * (node.sizes[i] ?? 1 / node.children.length);
      layout(c, x, cy, w, ch, out);
      cy += ch;
    });
  }
}

/**
 * Move focus from leaf `id` in a screen direction. Returns the neighbour leaf's
 * id, or `id` itself when there's no pane on that side. Chooses the candidate
 * whose perpendicular-axis overlap with the source is largest, tie-broken by
 * nearest edge — a forgiving "what's visually adjacent" heuristic.
 */
export function focusNeighbour(root: PaneNode, id: string, dir: FocusDir): string {
  const rects: Rect[] = [];
  layout(root, 0, 0, 1, 1, rects);
  const src = rects.find((r) => r.id === id);
  if (!src) return id;

  const EPS = 1e-6;
  const candidates = rects.filter((r) => {
    if (r.id === id) return false;
    switch (dir) {
      case 'left':
        return r.x + r.w <= src.x + EPS;
      case 'right':
        return r.x >= src.x + src.w - EPS;
      case 'up':
        return r.y + r.h <= src.y + EPS;
      case 'down':
        return r.y >= src.y + src.h - EPS;
    }
  });
  if (candidates.length === 0) return id;

  const overlap = (r: Rect): number => {
    if (dir === 'left' || dir === 'right') {
      return Math.min(src.y + src.h, r.y + r.h) - Math.max(src.y, r.y);
    }
    return Math.min(src.x + src.w, r.x + r.w) - Math.max(src.x, r.x);
  };
  const distance = (r: Rect): number => {
    switch (dir) {
      case 'left':
        return src.x - (r.x + r.w);
      case 'right':
        return r.x - (src.x + src.w);
      case 'up':
        return src.y - (r.y + r.h);
      case 'down':
        return r.y - (src.y + src.h);
    }
  };

  let best = candidates[0];
  let bestOverlap = overlap(best);
  let bestDist = distance(best);
  for (const r of candidates.slice(1)) {
    const ov = overlap(r);
    const d = distance(r);
    if (ov > bestOverlap + EPS || (Math.abs(ov - bestOverlap) <= EPS && d < bestDist)) {
      best = r;
      bestOverlap = ov;
      bestDist = d;
    }
  }
  // Require *some* perpendicular overlap; otherwise the pane isn't adjacent.
  return bestOverlap > EPS ? best.id : id;
}
