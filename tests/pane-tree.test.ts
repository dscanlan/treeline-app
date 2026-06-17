import { describe, expect, it } from 'vitest';
import {
  findLeaf,
  findLeafByPty,
  focusAfterRemoval,
  focusNeighbour,
  leaves,
  makeLeaf,
  mapLeaves,
  ptyIds,
  removePane,
  splitPane,
  type PaneNode,
  type PaneSplit,
} from '@shared/pane-tree';

function leaf(id: string, pty = `${id}-pty`): ReturnType<typeof makeLeaf> {
  return makeLeaf({ id, ptyId: pty, cwd: '/wt', title: id, createdAt: 0 });
}

describe('makeLeaf', () => {
  it('builds a leaf with sane defaults', () => {
    const l = makeLeaf({ ptyId: 'p1', cwd: '/wt', title: 't' });
    expect(l.kind).toBe('leaf');
    expect(l.ptyId).toBe('p1');
    expect(l.status).toBe('idle');
    expect(l.foregroundCmd).toBeNull();
    expect(typeof l.id).toBe('string');
  });
});

describe('leaves / ptyIds', () => {
  it('returns leaves in document order', () => {
    const root: PaneSplit = {
      kind: 'split',
      id: 's',
      direction: 'h',
      children: [leaf('a'), leaf('b'), leaf('c')],
      sizes: [1 / 3, 1 / 3, 1 / 3],
    };
    expect(leaves(root).map((l) => l.id)).toEqual(['a', 'b', 'c']);
    expect(ptyIds(root)).toEqual(['a-pty', 'b-pty', 'c-pty']);
  });

  it('a bare leaf is its own only leaf', () => {
    expect(leaves(leaf('x')).map((l) => l.id)).toEqual(['x']);
  });
});

describe('findLeaf / findLeafByPty', () => {
  const root: PaneSplit = {
    kind: 'split',
    id: 's',
    direction: 'v',
    children: [leaf('a'), { kind: 'split', id: 's2', direction: 'h', children: [leaf('b'), leaf('c')], sizes: [0.5, 0.5] }],
    sizes: [0.5, 0.5],
  };
  it('finds nested leaves by id', () => {
    expect(findLeaf(root, 'c')?.id).toBe('c');
    expect(findLeaf(root, 'missing')).toBeNull();
  });
  it('finds nested leaves by pty', () => {
    expect(findLeafByPty(root, 'b-pty')?.id).toBe('b');
    expect(findLeafByPty(root, 'nope')).toBeNull();
  });
});

describe('splitPane', () => {
  it('wraps a bare root leaf in a split of the given direction', () => {
    const root = leaf('a');
    const result = splitPane(root, 'a', 'h', leaf('b')) as PaneSplit;
    expect(result.kind).toBe('split');
    expect(result.direction).toBe('h');
    expect(result.children.map((c) => (c as { id: string }).id)).toEqual(['a', 'b']);
    expect(result.sizes).toEqual([0.5, 0.5]);
  });

  it('splices into a same-axis parent and re-evens sizes', () => {
    const root: PaneSplit = {
      kind: 'split',
      id: 's',
      direction: 'h',
      children: [leaf('a'), leaf('b')],
      sizes: [0.5, 0.5],
    };
    const result = splitPane(root, 'a', 'h', leaf('c')) as PaneSplit;
    expect(result.children.map((c) => (c as { id: string }).id)).toEqual(['a', 'c', 'b']);
    expect(result.sizes).toEqual([1 / 3, 1 / 3, 1 / 3]);
  });

  it('wraps the focused child when the new split is on the cross axis', () => {
    const root: PaneSplit = {
      kind: 'split',
      id: 's',
      direction: 'h',
      children: [leaf('a'), leaf('b')],
      sizes: [0.5, 0.5],
    };
    const result = splitPane(root, 'a', 'v', leaf('c')) as PaneSplit;
    expect(result.direction).toBe('h');
    const wrapped = result.children[0] as PaneSplit;
    expect(wrapped.kind).toBe('split');
    expect(wrapped.direction).toBe('v');
    expect(wrapped.children.map((c) => (c as { id: string }).id)).toEqual(['a', 'c']);
    // The other branch is untouched.
    expect((result.children[1] as { id: string }).id).toBe('b');
  });

  it('is a no-op when the focused id is absent', () => {
    const root = leaf('a');
    expect(splitPane(root, 'zzz', 'h', leaf('b'))).toBe(root);
  });

  it('splits a deeply nested focused leaf', () => {
    const root: PaneSplit = {
      kind: 'split',
      id: 's',
      direction: 'h',
      children: [leaf('a'), { kind: 'split', id: 's2', direction: 'v', children: [leaf('b'), leaf('c')], sizes: [0.5, 0.5] }],
      sizes: [0.5, 0.5],
    };
    const result = splitPane(root, 'b', 'v', leaf('d')) as PaneSplit;
    const inner = result.children[1] as PaneSplit;
    expect(inner.children.map((c) => (c as { id: string }).id)).toEqual(['b', 'd', 'c']);
  });
});

describe('removePane', () => {
  it('returns null when removing the only leaf', () => {
    expect(removePane(leaf('a'), 'a')).toBeNull();
  });

  it('collapses a 2-child split to its surviving child', () => {
    const root: PaneSplit = {
      kind: 'split',
      id: 's',
      direction: 'h',
      children: [leaf('a'), leaf('b')],
      sizes: [0.5, 0.5],
    };
    const result = removePane(root, 'a');
    expect(result?.kind).toBe('leaf');
    expect((result as { id: string }).id).toBe('b');
  });

  it('keeps a 3-child split and renormalises sizes', () => {
    const root: PaneSplit = {
      kind: 'split',
      id: 's',
      direction: 'h',
      children: [leaf('a'), leaf('b'), leaf('c')],
      sizes: [0.2, 0.3, 0.5],
    };
    const result = removePane(root, 'b') as PaneSplit;
    expect(result.children.map((c) => (c as { id: string }).id)).toEqual(['a', 'c']);
    const sum = result.sizes.reduce((x, y) => x + y, 0);
    expect(sum).toBeCloseTo(1);
    // Proportions preserved: a was 0.2, c was 0.5 → ratio 2:5.
    expect(result.sizes[0] / result.sizes[1]).toBeCloseTo(0.2 / 0.5);
  });

  it('collapses nested single-child chains', () => {
    const root: PaneSplit = {
      kind: 'split',
      id: 's',
      direction: 'h',
      children: [leaf('a'), { kind: 'split', id: 's2', direction: 'v', children: [leaf('b'), leaf('c')], sizes: [0.5, 0.5] }],
      sizes: [0.5, 0.5],
    };
    // Remove b then c → inner collapses; remove a's sibling entirely.
    const afterB = removePane(root, 'b') as PaneNode;
    // inner split had [b,c] → collapses to leaf c; root now [a, c]
    expect((afterB as PaneSplit).children.map((c) => (c as { id: string }).id)).toEqual(['a', 'c']);
    const afterC = removePane(afterB, 'c');
    expect(afterC?.kind).toBe('leaf');
    expect((afterC as { id: string }).id).toBe('a');
  });
});

describe('focusAfterRemoval', () => {
  const root: PaneSplit = {
    kind: 'split',
    id: 's',
    direction: 'h',
    children: [leaf('a'), leaf('b'), leaf('c')],
    sizes: [1 / 3, 1 / 3, 1 / 3],
  };
  it('prefers the next leaf', () => {
    expect(focusAfterRemoval(root, 'b')).toBe('c');
  });
  it('falls back to the previous leaf at the end', () => {
    expect(focusAfterRemoval(root, 'c')).toBe('b');
  });
  it('returns null when nothing else remains', () => {
    expect(focusAfterRemoval(leaf('only'), 'only')).toBeNull();
  });
});

describe('mapLeaves', () => {
  it('transforms every leaf and rebuilds splits', () => {
    const root: PaneSplit = {
      kind: 'split',
      id: 's',
      direction: 'h',
      children: [leaf('a'), leaf('b')],
      sizes: [0.5, 0.5],
    };
    const mapped = mapLeaves(root, (l) => ({ ...l, status: 'running' })) as PaneSplit;
    expect(leaves(mapped).every((l) => l.status === 'running')).toBe(true);
    expect(mapped.children).not.toBe(root.children);
  });
});

describe('focusNeighbour', () => {
  // Layout:  ┌───┬───┐
  //          │ a │ b │   (h split)
  //          └───┴───┘
  const hSplit: PaneSplit = {
    kind: 'split',
    id: 's',
    direction: 'h',
    children: [leaf('a'), leaf('b')],
    sizes: [0.5, 0.5],
  };
  it('moves right and left across an h split', () => {
    expect(focusNeighbour(hSplit, 'a', 'right')).toBe('b');
    expect(focusNeighbour(hSplit, 'b', 'left')).toBe('a');
  });
  it('stays put when there is no pane on that side', () => {
    expect(focusNeighbour(hSplit, 'a', 'left')).toBe('a');
    expect(focusNeighbour(hSplit, 'a', 'up')).toBe('a');
  });

  // Layout:  a | (b over c)
  const mixed: PaneSplit = {
    kind: 'split',
    id: 's',
    direction: 'h',
    children: [leaf('a'), { kind: 'split', id: 's2', direction: 'v', children: [leaf('b'), leaf('c')], sizes: [0.5, 0.5] }],
    sizes: [0.5, 0.5],
  };
  it('navigates into and within a nested split', () => {
    // From a, going right lands on the top-right pane (b) — it overlaps a's top half most.
    expect(focusNeighbour(mixed, 'a', 'right')).toBe('b');
    // From b, down lands on c.
    expect(focusNeighbour(mixed, 'b', 'down')).toBe('c');
    // From c, up lands on b.
    expect(focusNeighbour(mixed, 'c', 'up')).toBe('b');
    // From b, left lands back on a.
    expect(focusNeighbour(mixed, 'b', 'left')).toBe('a');
  });
  it('returns the same id for an unknown pane', () => {
    expect(focusNeighbour(mixed, 'zzz', 'right')).toBe('zzz');
  });
});
