import { describe, expect, it } from 'vitest';
import { makeLeaf, type PaneNode, type PaneSplit } from '@shared/pane-tree';
import type { PersistedSplit, Tab } from '@shared/types';
import {
  agentPaneCwds,
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
  it('strips runtime-only fields and tags agent panes with their kind', () => {
    const session = toPersistedSession([splitTab()], 'tab-1');
    expect(session.version).toBe(1);
    expect(session.activeTabId).toBe('tab-1');

    const root = session.tabs[0].root as PersistedSplit;
    expect(root.kind).toBe('split');
    expect(root.direction).toBe('h');
    expect(root.sizes).toEqual([0.6, 0.4]);

    const [a, b] = root.children;
    // Runtime fields gone: no ptyId / status / foregroundCmd on the persisted leaf.
    expect(a).toEqual({ kind: 'leaf', id: 'a', cwd: '/wt', title: 'a', agentKind: 'claude' });
    expect(b).toEqual({ kind: 'leaf', id: 'b', cwd: '/wt', title: 'b' });
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
      agentKind: 'claude',
      agentSessionId: 'sess-9',
    });
    // The non-agent pane never gets an id, even if its cwd is in the map.
    expect('agentSessionId' in b).toBe(false);
  });

  it('omits the pin when the cwd is absent from the map', () => {
    const session = toPersistedSession([splitTab()], 'tab-1', new Map());
    const root = session.tabs[0].root as PersistedSplit;
    expect('agentSessionId' in root.children[0]).toBe(false);
  });
});

describe('toPersistedSession — per-pane pinning', () => {
  /** Two claude panes in the SAME cwd — indistinguishable by directory alone. */
  function twoClaudePanesTab(): Tab {
    const root: PaneSplit = {
      kind: 'split',
      id: 'split-2',
      direction: 'h',
      children: [
        liveLeaf('a', { foregroundCmd: 'claude' }),
        liveLeaf('b', { foregroundCmd: 'claude' }),
      ],
      sizes: [0.5, 0.5],
    };
    return {
      id: 'tab-2',
      cwd: '/wt',
      title: 'wt',
      root,
      focusedPaneId: 'a',
      createdAt: 0,
      lastActiveAt: 0,
    };
  }

  it('pins distinct sessions onto two claude panes sharing a cwd', () => {
    const session = toPersistedSession(
      [twoClaudePanesTab()],
      'tab-2',
      new Map(),
      new Set(),
      new Map([
        ['a-pty', { kind: 'claude' as const, sessionId: 'sess-a' }],
        ['b-pty', { kind: 'claude' as const, sessionId: 'sess-b' }],
      ]),
    );
    const root = session.tabs[0].root as PersistedSplit;
    const [a, b] = root.children;
    expect(a).toMatchObject({ agentKind: 'claude', agentSessionId: 'sess-a' });
    expect(b).toMatchObject({ agentKind: 'claude', agentSessionId: 'sess-b' });
  });

  it('prefers the pane pin over the cwd pin', () => {
    const session = toPersistedSession(
      [splitTab()],
      'tab-1',
      new Map([['/wt', 'sess-cwd']]),
      new Set(),
      new Map([['a-pty', { kind: 'claude' as const, sessionId: 'sess-pane' }]]),
    );
    const root = session.tabs[0].root as PersistedSplit;
    expect(root.children[0]).toMatchObject({ agentSessionId: 'sess-pane' });
  });

  it('falls back to the cwd pin for a pane with no reported session', () => {
    const session = toPersistedSession(
      [twoClaudePanesTab()],
      'tab-2',
      new Map([['/wt', 'sess-cwd']]),
      new Set(),
      new Map([['a-pty', { kind: 'claude' as const, sessionId: 'sess-a' }]]),
    );
    const root = session.tabs[0].root as PersistedSplit;
    expect(root.children[0]).toMatchObject({ agentSessionId: 'sess-a' });
    expect(root.children[1]).toMatchObject({ agentSessionId: 'sess-cwd' });
  });

  it('never pins a pane id onto a non-agent pane', () => {
    const session = toPersistedSession(
      [splitTab()], // leaf b runs vim
      'tab-1',
      new Map(),
      new Set(),
      new Map([['b-pty', { kind: 'claude' as const, sessionId: 'sess-b' }]]),
    );
    const root = session.tabs[0].root as PersistedSplit;
    expect('agentSessionId' in root.children[1]).toBe(false);
  });

  it('drops a pin recorded under a different kind than the pane now runs', () => {
    // Pane a's pty carries a claude-reported id, but the pane has since been
    // taken over by opencode — applying the stale claude id would resume the
    // wrong agent's session, so the pin must be dropped (and the claude-only
    // cwd fallback must not apply to an opencode pane either).
    const root: PaneSplit = {
      kind: 'split',
      id: 'split-3',
      direction: 'h',
      children: [
        liveLeaf('a', { foregroundCmd: 'opencode' }),
        liveLeaf('b', { foregroundCmd: 'vim' }),
      ],
      sizes: [0.5, 0.5],
    };
    const tab: Tab = {
      id: 'tab-3',
      cwd: '/wt',
      title: 'wt',
      root,
      focusedPaneId: 'a',
      createdAt: 0,
      lastActiveAt: 0,
    };
    const session = toPersistedSession(
      [tab],
      'tab-3',
      new Map([['/wt', 'sess-cwd']]),
      new Set(),
      new Map([['a-pty', { kind: 'claude' as const, sessionId: 'stale-claude-id' }]]),
    );
    const persisted = (session.tabs[0].root as PersistedSplit).children[0];
    expect(persisted).toMatchObject({ agentKind: 'opencode' });
    expect('agentSessionId' in persisted).toBe(false);
  });

  it('applies a matching-kind pin onto a non-claude agent pane', () => {
    const tab: Tab = {
      id: 'tab-4',
      cwd: '/wt',
      title: 'wt',
      root: liveLeaf('a', { foregroundCmd: 'opencode' }),
      focusedPaneId: 'a',
      createdAt: 0,
      lastActiveAt: 0,
    };
    const session = toPersistedSession(
      [tab],
      'tab-4',
      new Map(),
      new Set(),
      new Map([['a-pty', { kind: 'opencode' as const, sessionId: 'oc-1' }]]),
    );
    expect(session.tabs[0].root).toMatchObject({
      agentKind: 'opencode',
      agentSessionId: 'oc-1',
    });
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

describe('agentPaneCwds', () => {
  it('returns the distinct cwds of panes running the given kind only', () => {
    const t1 = splitTab(); // leaf a (claude) + b (vim), both /wt
    const t2 = { ...splitTab(), id: 't2', cwd: '/other' };
    expect(agentPaneCwds([t1, t2], 'claude')).toEqual(['/wt']);
    expect(agentPaneCwds([t1, t2], 'opencode')).toEqual([]);
  });

  it('skips panes whose pty already has a per-pane pin', () => {
    // splitTab()'s only claude pane is `a` (ptyId a-pty); once it's pinned
    // per-pane there's no cwd left needing the fallback look-up.
    expect(agentPaneCwds([splitTab()], 'claude', new Set(['a-pty']))).toEqual([]);
  });

  it('is empty when no pane runs the kind', () => {
    const tab: Tab = {
      id: 't',
      cwd: '/x',
      title: 'x',
      root: liveLeaf('solo', { cwd: '/x', foregroundCmd: 'vim' }),
      focusedPaneId: 'solo',
      createdAt: 0,
      lastActiveAt: 0,
    };
    expect(agentPaneCwds([tab], 'claude')).toEqual([]);
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
