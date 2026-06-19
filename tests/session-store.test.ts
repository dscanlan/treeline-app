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
          { kind: 'leaf', id: 'a', cwd: '/wt', title: 'a', claudePane: true },
          { kind: 'leaf', id: 'b', cwd: '/wt', title: 'b', claudePane: false },
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
        { id: 'ok', cwd: '/x', title: 'x', focusedPaneId: 'l', root: { kind: 'leaf', id: 'l', cwd: '/x', title: 'x', claudePane: false } },
        { id: 'no-root', cwd: '/y' },
        { cwd: '/z', root: { kind: 'leaf', id: 'm', cwd: '/z', title: 'm', claudePane: false } },
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
            children: [{ kind: 'leaf', id: 'a', cwd: '/x', title: 'a', claudePane: false }],
          },
        },
      ],
      activeTabId: 't',
    });
    expect(s.tabs[0].root).toEqual({ kind: 'leaf', id: 'a', cwd: '/x', title: 'a', claudePane: false });
  });

  it('nulls an activeTabId that no surviving tab matches', () => {
    const s = coerceSession({ version: 1, tabs: [], activeTabId: 'gone' });
    expect(s.activeTabId).toBeNull();
  });

  it('preserves a valid pinned claudeSessionId and drops a non-string one', () => {
    const make = (sessionId: unknown) => ({
      version: 1,
      tabs: [
        {
          id: 't',
          cwd: '/x',
          title: 'x',
          focusedPaneId: 'a',
          root: { kind: 'leaf', id: 'a', cwd: '/x', title: 'a', claudePane: true, claudeSessionId: sessionId },
        },
      ],
      activeTabId: 't',
    });
    const kept = coerceSession(make('sess-1')).tabs[0].root;
    expect(kept).toMatchObject({ claudePane: true, claudeSessionId: 'sess-1' });

    const dropped = coerceSession(make(42)).tabs[0].root;
    expect('claudeSessionId' in dropped).toBe(false);
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
              { kind: 'leaf', id: 'a', cwd: '/x', title: 'a', claudePane: false },
              { kind: 'leaf', id: 'b', cwd: '/x', title: 'b', claudePane: false },
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
