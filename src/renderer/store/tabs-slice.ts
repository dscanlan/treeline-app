import type { StateCreator } from 'zustand';
import type { Tab, TabStatus, TerminalStatusUpdate } from '@shared/types';
import { basename } from '../util/path';

export interface TabsSlice {
  tabs: Tab[];
  activeTabId: string | null;
  /** cwd → tab IDs in MRU order (index 0 = most recently active). */
  tabsByCwd: Record<string, string[]>;

  /**
   * Append a new tab; caller passes the freshly-spawned ptyId. `title`
   * overrides the default `basename(cwd)` — used by scratch terminals which
   * want "Scratch N" instead of the cwd's basename.
   */
  addTab: (input: { ptyId: string; cwd: string; title?: string }) => string;
  /** Remove a tab; returns the next tab id to activate (or null). */
  removeTab: (id: string) => string | null;
  /** Switch active tab and bump MRU. */
  setActive: (id: string) => void;
  /**
   * Move the tab with `id` to position `toIndex` in the visible strip. Only
   * reorders the `tabs` array — leaves `tabsByCwd` (MRU focus order) untouched.
   */
  reorderTab: (id: string, toIndex: number) => void;
  /** Apply per-PTY status updates from the main process. */
  applyStatusUpdates: (updates: TerminalStatusUpdate[]) => void;
  /** Aggregate worktree status: running → idle → exited. Null if no tabs. */
  worktreeStatus: (cwd: string) => TabStatus | null;
}

export const createTabsSlice: StateCreator<TabsSlice, [], [], TabsSlice> = (set, get) => ({
  tabs: [],
  activeTabId: null,
  tabsByCwd: {},

  addTab: ({ ptyId, cwd, title }) => {
    const id = ptyId; // ptyId is already a uuid; reuse as tab id.
    const now = Date.now();
    const tab: Tab = {
      id,
      ptyId,
      cwd,
      title: title ?? basename(cwd),
      status: 'idle',
      foregroundCmd: null,
      createdAt: now,
      lastActiveAt: now,
    };
    set((s) => {
      const existing = s.tabsByCwd[cwd] ?? [];
      return {
        tabs: [...s.tabs, tab],
        activeTabId: id,
        tabsByCwd: { ...s.tabsByCwd, [cwd]: [id, ...existing] },
      };
    });
    return id;
  },

  removeTab: (id) => {
    let nextActive: string | null = null;
    set((s) => {
      const removed = s.tabs.find((t) => t.id === id);
      if (!removed) return s;
      const tabs = s.tabs.filter((t) => t.id !== id);
      const cwdList = (s.tabsByCwd[removed.cwd] ?? []).filter((x) => x !== id);
      const tabsByCwd = { ...s.tabsByCwd };
      if (cwdList.length === 0) delete tabsByCwd[removed.cwd];
      else tabsByCwd[removed.cwd] = cwdList;

      // If the active tab was removed, prefer the next-MRU tab on the same
      // cwd, then fall back to whatever's left at the same array index.
      let activeTabId = s.activeTabId;
      if (s.activeTabId === id) {
        activeTabId = cwdList[0] ?? tabs[0]?.id ?? null;
      }
      nextActive = activeTabId;
      return { tabs, tabsByCwd, activeTabId };
    });
    return nextActive;
  },

  setActive: (id) =>
    set((s) => {
      const tab = s.tabs.find((t) => t.id === id);
      if (!tab) return s;
      const now = Date.now();
      const tabs = s.tabs.map((t) => (t.id === id ? { ...t, lastActiveAt: now } : t));
      const cwdList = s.tabsByCwd[tab.cwd] ?? [];
      const reordered = [id, ...cwdList.filter((x) => x !== id)];
      return {
        tabs,
        activeTabId: id,
        tabsByCwd: { ...s.tabsByCwd, [tab.cwd]: reordered },
      };
    }),

  reorderTab: (id, toIndex) =>
    set((s) => {
      const from = s.tabs.findIndex((t) => t.id === id);
      if (from === -1) return s;
      const to = Math.max(0, Math.min(toIndex, s.tabs.length - 1));
      if (from === to) return s;
      const tabs = [...s.tabs];
      const [moved] = tabs.splice(from, 1);
      tabs.splice(to, 0, moved);
      return { tabs };
    }),

  applyStatusUpdates: (updates) =>
    set((s) => {
      if (updates.length === 0) return s;
      const byPtyId = new Map<string, TerminalStatusUpdate>();
      for (const u of updates) byPtyId.set(u.ptyId, u);
      const tabs = s.tabs.map((t) => {
        const u = byPtyId.get(t.ptyId);
        if (!u) return t;
        return { ...t, status: u.status, foregroundCmd: u.foregroundCmd };
      });
      return { tabs };
    }),

  worktreeStatus: (cwd) => {
    const ids = get().tabsByCwd[cwd];
    if (!ids || ids.length === 0) return null;
    const tabs = get().tabs;
    const statuses = ids
      .map((id) => tabs.find((t) => t.id === id)?.status)
      .filter((x): x is TabStatus => x !== undefined);
    if (statuses.includes('running')) return 'running';
    if (statuses.includes('idle')) return 'idle';
    if (statuses.includes('exited')) return 'exited';
    return null;
  },
});
