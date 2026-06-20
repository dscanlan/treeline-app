import { describe, expect, it } from 'vitest';
import { makeLeaf, type PaneNode, type PaneSplit } from '@shared/pane-tree';
import type { PersistedSplit, Tab } from '@shared/types';
import {
  claudePaneCwds,
  persistedLeaves,
  persistedToLiveTree,
  rebuildTabsByCwd,
  toPersistedSession,
} from '@shared/session-serialize';

function liveLeaf(
  id: string,
  opts: Partial<{ ptyId: string; cwd: string; foregroundCmd: string | null }> = {},
): ReturnType<typeof makeLeaf> {
  return makeLeaf({
    id,
    ptyId: opts.ptyId ?? `${id}-pty`,
    cwd: opts.cwd ?? '/wt',
    title: id,
    status: 'running',
    foregroundCmd: opts.foregroundCmd ?? null,
    createdAt: 0,
  });
}

/** A tab whose root is a horizontal split of two leaves. */
function splitTab(): Tab {
  const root: PaneSplit = {
    kind: 'split',
    id: 'split-1',
    direction: 'h',
    children: [
      liveLeaf('a', { foregroundCmd: 'claude' }),
      liveLeaf('b', { foregroundCmd: 'vim' }),
    ],
    sizes: [0.6, 0.4],
  };
  return {
    id: 'tab-1',
    cwd: '/wt',
    title: 'wt',
    root,
    focusedPaneId: 'a',
    createdAt: 0,
    lastActiveAt: 0,
  };
}

describe('toPersistedSession', () => {
  it('strips runtime-only fields and flags claude panes', () => {
    const session = toPersistedSession([splitTab()], 'tab-1');
    expect(session.version).toBe(1);
    expect(session.activeTabId).toBe('tab-1');

    const root = session.tabs[0].root as PersistedSplit;
    expect(root.kind).toBe('split');
    expect(root.direction).toBe('h');
    expect(root.sizes).toEqual([0.6, 0.4]);

    const [a, b] = root.children;
    // Runtime fields gone: no ptyId / status / foregroundCmd on the persisted leaf.
    expect(a).toEqual({ kind: 'leaf', id: 'a', cwd: '/wt', title: 'a', claudePane: true });
    expect(b).toEqual({ kind: 'leaf', id: 'b', cwd: '/wt', title: 'b', claudePane: false });
    expect('ptyId' in a).toBe(false);
    expect('foregroundCmd' in a).toBe(false);
  });

  it('preserves tab identity and focus', () => {
    const session = toPersistedSession([splitTab()], 'tab-1');
    expect(session.tabs[0].id).toBe('tab-1');
    expect(session.tabs[0].focusedPaneId).toBe('a');
    expect(session.tabs[0].cwd).toBe('/wt');
  });

  it('pins a session id onto claude panes only (from sessionIdByCwd)', () => {
    const session = toPersistedSession([splitTab()], 'tab-1', new Map([['/wt', 'sess-9']]));
    const root = session.tabs[0].root as PersistedSplit;
    const [a, b] = root.children;
    expect(a).toEqual({
      kind: 'leaf',
      id: 'a',
      cwd: '/wt',
      title: 'a',
      claudePane: true,
      claudeSessionId: 'sess-9',
    });
    // The non-claude pane never gets an id, even if its cwd is in the map.
    expect('claudeSessionId' in b).toBe(false);
  });

  it('omits the pin when the cwd is absent from the map', () => {
    const session = toPersistedSession([splitTab()], 'tab-1', new Map());
    const root = session.tabs[0].root as PersistedSplit;
    expect('claudeSessionId' in root.children[0]).toBe(false);
  });
});

describe('toPersistedSession — scratch flag', () => {
  function soloTab(ptyId: string): Tab {
    return {
      id: 'tab-s',
      cwd: '/home/me',
      title: 'Scratch 2',
      root: liveLeaf('solo', { ptyId, cwd: '/home/me' }),
      focusedPaneId: 'solo',
      createdAt: 0,
      lastActiveAt: 0,
    };
  }

  it('flags an unsplit tab whose leaf PTY is a known scratch', () => {
    const session = toPersistedSession(
      [soloTab('scratch-pty')],
      'tab-s',
      new Map(),
      new Set(['scratch-pty']),
    );
    expect(session.tabs[0].scratch).toBe(true);
  });

  it('omits the flag when the leaf PTY is not a scratch', () => {
    const session = toPersistedSession([soloTab('plain-pty')], 'tab-s', new Map(), new Set(['other']));
    expect('scratch' in session.tabs[0]).toBe(false);
  });

  it('never flags a split tab, even if a child PTY is a scratch', () => {
    // splitTab()'s leaves use ptyIds `a-pty` / `b-pty`.
    const session = toPersistedSession([splitTab()], 'tab-1', new Map(), new Set(['a-pty']));
    expect('scratch' in session.tabs[0]).toBe(false);
  });
});

describe('claudePaneCwds', () => {
  it('returns the distinct cwds of claude panes only', () => {
    const t1 = splitTab(); // leaf a (claude) + b (vim), both /wt
    const t2 = { ...splitTab(), id: 't2', cwd: '/other' };
    expect(claudePaneCwds([t1, t2])).toEqual(['/wt']);
  });

  it('is empty when no pane runs claude', () => {
    const tab: Tab = {
      id: 't',
      cwd: '/x',
      title: 'x',
      root: liveLeaf('solo', { cwd: '/x', foregroundCmd: 'vim' }),
      focusedPaneId: 'solo',
      createdAt: 0,
      lastActiveAt: 0,
    };
    expect(claudePaneCwds([tab])).toEqual([]);
  });
});

describe('persistedToLiveTree', () => {
  it('rebuilds the tree with new pty ids, keeping layout + node ids', () => {
    const persisted = toPersistedSession([splitTab()], 'tab-1').tabs[0].root;
    const ptyByLeafId = new Map([
      ['a', 'new-pty-a'],
      ['b', 'new-pty-b'],
    ]);
    const live = persistedToLiveTree(persisted, ptyByLeafId) as PaneNode;

    expect(live.kind).toBe('split');
    if (live.kind !== 'split') return;
    expect(live.id).toBe('split-1');
    expect(live.direction).toBe('h');
    expect(live.sizes).toEqual([0.6, 0.4]);

    const [a, b] = live.children;
    if (a.kind !== 'leaf' || b.kind !== 'leaf') throw new Error('expected leaves');
    expect(a.id).toBe('a');
    expect(a.ptyId).toBe('new-pty-a');
    expect(a.status).toBe('running');
    expect(a.foregroundCmd).toBeNull();
    expect(b.ptyId).toBe('new-pty-b');
  });

  it('round-trips a single-leaf tab', () => {
    const tab: Tab = {
      id: 't',
      cwd: '/x',
      title: 'x',
      root: liveLeaf('solo', { cwd: '/x' }),
      focusedPaneId: 'solo',
      createdAt: 0,
      lastActiveAt: 0,
    };
    const persisted = toPersistedSession([tab], 't').tabs[0].root;
    const live = persistedToLiveTree(persisted, new Map([['solo', 'p2']]));
    expect(live.kind).toBe('leaf');
    if (live.kind !== 'leaf') return;
    expect(live.ptyId).toBe('p2');
    expect(live.cwd).toBe('/x');
  });
});

describe('persistedLeaves', () => {
  it('returns every leaf in document order', () => {
    const persisted = toPersistedSession([splitTab()], 'tab-1').tabs[0].root;
    expect(persistedLeaves(persisted).map((l) => l.id)).toEqual(['a', 'b']);
  });
});

describe('rebuildTabsByCwd', () => {
  it('indexes tab ids by cwd', () => {
    const t1 = { ...splitTab(), id: 't1', cwd: '/a' };
    const t2 = { ...splitTab(), id: 't2', cwd: '/a' };
    const t3 = { ...splitTab(), id: 't3', cwd: '/b' };
    expect(rebuildTabsByCwd([t1, t2, t3])).toEqual({ '/a': ['t1', 't2'], '/b': ['t3'] });
  });
});
