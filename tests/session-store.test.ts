import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SessionStore, coerceSession } from '../src/main/session-store';
import type { PersistedSession } from '@shared/types';

const SESSION: PersistedSession = {
  version: 1,
  tabs: [
    {
      id: 'tab-1',
      cwd: '/wt',
      title: 'wt',
      focusedPaneId: 'a',
      root: {
        kind: 'split',
        id: 's',
        direction: 'h',
        sizes: [0.5, 0.5],
        children: [
          { kind: 'leaf', id: 'a', cwd: '/wt', title: 'a', agentKind: 'claude' },
          { kind: 'leaf', id: 'b', cwd: '/wt', title: 'b' },
        ],
      },
    },
  ],
  activeTabId: 'tab-1',
};

describe('SessionStore', () => {
  let dir: string;
  let sessionPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'treeline-session-'));
    sessionPath = join(dir, 'session.json');
  });

  afterEach(() => {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it('load() returns an empty session when the file is missing', () => {
    const store = new SessionStore(sessionPath);
    const s = store.load();
    expect(s).toEqual({ version: 1, tabs: [], activeTabId: null });
  });

  it('set() then a fresh load() round-trips through disk atomically', async () => {
    const a = new SessionStore(sessionPath);
    a.load();
    await a.set(SESSION);

    const b = new SessionStore(sessionPath);
    expect(b.load()).toEqual(SESSION);
  });

  it('a corrupt file falls back to an empty session rather than throwing', () => {
    writeFileSync(sessionPath, '{ not valid json', 'utf8');
    const store = new SessionStore(sessionPath);
    expect(store.load()).toEqual({ version: 1, tabs: [], activeTabId: null });
  });
});

describe('coerceSession', () => {
  it('drops non-object input to an empty session', () => {
    expect(coerceSession(null)).toEqual({ version: 1, tabs: [], activeTabId: null });
    expect(coerceSession(42)).toEqual({ version: 1, tabs: [], activeTabId: null });
  });

  it('drops malformed tabs and tabs without a valid root', () => {
    const s = coerceSession({
      version: 1,
      tabs: [
        { id: 'ok', cwd: '/x', title: 'x', focusedPaneId: 'l', root: { kind: 'leaf', id: 'l', cwd: '/x', title: 'x' } },
        { id: 'no-root', cwd: '/y' },
        { cwd: '/z', root: { kind: 'leaf', id: 'm', cwd: '/z', title: 'm' } },
      ],
      activeTabId: 'ok',
    });
    expect(s.tabs.map((t) => t.id)).toEqual(['ok']);
    expect(s.activeTabId).toBe('ok');
  });

  it('collapses a degenerate single-child split to its child', () => {
    const s = coerceSession({
      version: 1,
      tabs: [
        {
          id: 't',
          cwd: '/x',
          title: 'x',
          focusedPaneId: 'a',
          root: {
            kind: 'split',
            id: 's',
            direction: 'h',
            sizes: [1],
            children: [{ kind: 'leaf', id: 'a', cwd: '/x', title: 'a' }],
          },
        },
      ],
      activeTabId: 't',
    });
    expect(s.tabs[0].root).toEqual({ kind: 'leaf', id: 'a', cwd: '/x', title: 'a' });
  });

  it('nulls an activeTabId that no surviving tab matches', () => {
    const s = coerceSession({ version: 1, tabs: [], activeTabId: 'gone' });
    expect(s.activeTabId).toBeNull();
  });

  it('preserves a valid pinned agentSessionId and drops a non-string one', () => {
    const make = (sessionId: unknown) => ({
      version: 1,
      tabs: [
        {
          id: 't',
          cwd: '/x',
          title: 'x',
          focusedPaneId: 'a',
          root: { kind: 'leaf', id: 'a', cwd: '/x', title: 'a', agentKind: 'claude', agentSessionId: sessionId },
        },
      ],
      activeTabId: 't',
    });
    const kept = coerceSession(make('sess-1')).tabs[0].root;
    expect(kept).toMatchObject({ agentKind: 'claude', agentSessionId: 'sess-1' });

    const dropped = coerceSession(make(42)).tabs[0].root;
    expect('agentSessionId' in dropped).toBe(false);
  });

  it('preserves a scratch tab flag, and drops a non-true value', () => {
    const make = (scratch: unknown): unknown => ({
      version: 1,
      tabs: [
        {
          id: 't',
          cwd: '/home/me',
          title: 'Scratch 1',
          focusedPaneId: 'a',
          scratch,
          root: { kind: 'leaf', id: 'a', cwd: '/home/me', title: 'Scratch 1' },
        },
      ],
      activeTabId: 't',
    });
    expect(coerceSession(make(true)).tabs[0]).toMatchObject({ scratch: true });
    // Anything other than the literal `true` (e.g. a truthy string) is dropped.
    expect('scratch' in coerceSession(make('yes')).tabs[0]).toBe(false);
    expect('scratch' in coerceSession(make(false)).tabs[0]).toBe(false);
  });

  it('migrates a legacy claudePane/claudeSessionId leaf on read', () => {
    // Shape-based migration: presence of `claudePane` marks a legacy
    // (pre-agent-registry, ≤v0.22.0) snapshot. Writes only ever emit the new
    // shape, so the legacy keys must not survive coercion.
    const s = coerceSession({
      version: 1,
      tabs: [
        {
          id: 't',
          cwd: '/x',
          title: 'x',
          focusedPaneId: 'a',
          root: {
            kind: 'split',
            id: 's',
            direction: 'h',
            sizes: [0.5, 0.5],
            children: [
              { kind: 'leaf', id: 'a', cwd: '/x', title: 'a', claudePane: true, claudeSessionId: 'sess-1' },
              { kind: 'leaf', id: 'b', cwd: '/x', title: 'b', claudePane: false },
            ],
          },
        },
      ],
      activeTabId: 't',
    });
    const root = s.tabs[0].root;
    if (root.kind !== 'split') throw new Error('expected split');
    const [a, b] = root.children;
    expect(a).toEqual({
      kind: 'leaf',
      id: 'a',
      cwd: '/x',
      title: 'a',
      agentKind: 'claude',
      agentSessionId: 'sess-1',
    });
    expect(b).toEqual({ kind: 'leaf', id: 'b', cwd: '/x', title: 'b' });
    expect('claudePane' in a).toBe(false);
    expect('claudeSessionId' in a).toBe(false);
  });

  it('a full legacy v0.22.0 session.json on disk restores through SessionStore migrated', () => {
    const dir = mkdtempSync(join(tmpdir(), 'treeline-session-migrate-'));
    const sessionPath = join(dir, 'session.json');
    try {
      writeFileSync(
        sessionPath,
        JSON.stringify({
          version: 1,
          tabs: [
            {
              id: 'tab-1',
              cwd: '/repo',
              title: 'repo',
              focusedPaneId: 'p1',
              root: {
                kind: 'leaf',
                id: 'p1',
                cwd: '/repo',
                title: 'repo',
                claudePane: true,
                claudeSessionId: 'abc-123',
              },
            },
          ],
          activeTabId: 'tab-1',
        }),
        'utf8',
      );
      const store = new SessionStore(sessionPath);
      const loaded = store.load();
      expect(loaded.tabs[0].root).toEqual({
        kind: 'leaf',
        id: 'p1',
        cwd: '/repo',
        title: 'repo',
        agentKind: 'claude',
        agentSessionId: 'abc-123',
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('drops an agentSessionId that arrives without an agentKind', () => {
    const s = coerceSession({
      version: 1,
      tabs: [
        {
          id: 't',
          cwd: '/x',
          title: 'x',
          focusedPaneId: 'a',
          root: { kind: 'leaf', id: 'a', cwd: '/x', title: 'a', agentSessionId: 'orphan' },
        },
      ],
      activeTabId: 't',
    });
    expect('agentSessionId' in s.tabs[0].root).toBe(false);
  });

  it('degrades an unknown agentKind (snapshot from a newer build) to a plain shell', () => {
    const s = coerceSession({
      version: 1,
      tabs: [
        {
          id: 't',
          cwd: '/x',
          title: 'x',
          focusedPaneId: 'a',
          root: { kind: 'leaf', id: 'a', cwd: '/x', title: 'a', agentKind: 'cursor-9000', agentSessionId: 'z' },
        },
      ],
      activeTabId: 't',
    });
    expect(s.tabs[0].root).toEqual({ kind: 'leaf', id: 'a', cwd: '/x', title: 'a' });
  });

  it('round-trips a non-claude agent pane through save → disk → load', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'treeline-session-opencode-'));
    const sessionPath = join(dir, 'session.json');
    try {
      const store = new SessionStore(sessionPath);
      store.load();
      await store.set({
        version: 1,
        tabs: [
          {
            id: 't',
            cwd: '/x',
            title: 'x',
            focusedPaneId: 'a',
            root: { kind: 'leaf', id: 'a', cwd: '/x', title: 'a', agentKind: 'opencode' },
          },
        ],
        activeTabId: 't',
      });
      const fresh = new SessionStore(sessionPath);
      expect(fresh.load().tabs[0].root).toEqual({
        kind: 'leaf',
        id: 'a',
        cwd: '/x',
        title: 'a',
        agentKind: 'opencode',
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('defaults mismatched split sizes to an even split', () => {
    const s = coerceSession({
      version: 1,
      tabs: [
        {
          id: 't',
          cwd: '/x',
          title: 'x',
          focusedPaneId: 'a',
          root: {
            kind: 'split',
            id: 's',
            direction: 'v',
            sizes: [0.9], // wrong length for 2 children
            children: [
              { kind: 'leaf', id: 'a', cwd: '/x', title: 'a' },
              { kind: 'leaf', id: 'b', cwd: '/x', title: 'b' },
            ],
          },
        },
      ],
      activeTabId: 't',
    });
    const root = s.tabs[0].root;
    expect(root.kind).toBe('split');
    if (root.kind !== 'split') return;
    expect(root.sizes).toEqual([0.5, 0.5]);
  });
});
