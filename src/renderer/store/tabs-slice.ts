import type { StateCreator } from 'zustand';
import type { Tab, TabStatus, TerminalStatusUpdate } from '@shared/types';
import type { PaneLeaf, SplitDirection } from '@shared/pane-tree';
import {
  findLeaf,
  findLeafByPty,
  focusAfterRemoval,
  leaves,
  makeLeaf,
  mapLeaves,
  removePane as removePaneFromTree,
  setSizes,
  splitPane,
} from '@shared/pane-tree';
import { basename } from '../util/path';

/** An agent-attention notification awaiting acknowledgement, keyed by pty id. */
export interface UnreadNotification {
  /** The notification text the agent raised (latest wins for a given pty). */
  text: string;
  /** epoch ms it arrived — drives "jump to most recent unread". */
  at: number;
}

export interface TabsSlice {
  tabs: Tab[];
  activeTabId: string | null;
  /** cwd → tab IDs in MRU order (index 0 = most recently active). */
  tabsByCwd: Record<string, string[]>;
  /**
   * Pending agent-attention notifications, keyed by the raising pane's pty id.
   * Deliberately **transient** (never persisted/restored): a stale "needs
   * attention" flag from a previous session would be a lie. Set by
   * `markNotification` (OSC 9/99/777 or the `treeline notify` CLI) and cleared
   * when the human looks at the pane (focus) or the tab/pane goes away.
   */
  unreadByPtyId: Record<string, UnreadNotification>;

  /**
   * Append a new tab seeded with a single pane around the freshly-spawned
   * ptyId. `title` overrides the default `basename(cwd)` — used by scratch
   * terminals which want "Scratch N" instead of the cwd's basename.
   */
  addTab: (input: { ptyId: string; cwd: string; title?: string }) => string;
  /** Remove an entire tab; returns the next tab id to activate (or null). */
  removeTab: (id: string) => string | null;
  /** Switch active tab and bump MRU. */
  setActive: (id: string) => void;
  /**
   * Move the tab with `id` to position `toIndex` in the visible strip. Only
   * reorders the `tabs` array — leaves `tabsByCwd` (MRU focus order) untouched.
   */
  reorderTab: (id: string, toIndex: number) => void;

  /**
   * Split the focused pane of `tabId` in `dir`, inserting a new leaf around
   * `pty` (already spawned). The new pane becomes focused. cwd is inherited by
   * the caller (it passes the new leaf's cwd/title). No-op if the tab is gone.
   */
  splitFocusedPane: (
    tabId: string,
    dir: SplitDirection,
    leaf: { ptyId: string; cwd: string; title: string },
  ) => void;
  /**
   * Remove pane `paneId` from tab `tabId`. Collapses single-child splits and
   * re-focuses a neighbour. If that empties the tab, the tab is removed too;
   * returns the next tab id to activate when the tab was removed (else null).
   */
  removePane: (tabId: string, paneId: string) => string | null;
  /** Focus a specific pane within a tab (e.g. on click or directional move). */
  setFocusedPane: (tabId: string, paneId: string) => void;
  /** Set the fractional `sizes` of one split node (from a divider drag). */
  setPaneSizes: (tabId: string, splitId: string, sizes: number[]) => void;

  /** Apply per-PTY status updates from the main process, per leaf. */
  applyStatusUpdates: (updates: TerminalStatusUpdate[]) => void;
  /**
   * Aggregate worktree status across every pane of every tab on `cwd`:
   * running → idle → exited. Null if no panes.
   */
  worktreeStatus: (cwd: string) => TabStatus | null;

  /**
   * Record an attention notification for the pane hosting `ptyId`. No-op (the
   * human is already looking) when that pane is the focused pane of the active
   * tab and the window itself is focused.
   */
  markNotification: (ptyId: string, text: string) => void;
  /** Clear the unread flag for a single pane (e.g. it just gained focus). */
  clearUnread: (ptyId: string) => void;
  /** True if any pane of any tab bound to `cwd` is unread (sidebar badge). */
  cwdHasUnread: (cwd: string) => boolean;
  /** True if any pane of the tab `tabId` is unread (tab-strip indicator). */
  tabHasUnread: (tabId: string) => boolean;
  /**
   * The most-recently-raised unread pane still present in a live tab, or null.
   * Drives the ⌘⇧U jump-to-unread accelerator.
   */
  mostRecentUnread: () => { ptyId: string; tabId: string; paneId: string } | null;
}

/** Drop every entry of `unread` whose pty id is in `ptyIds`. Returns same ref if unchanged. */
function clearUnreadFor(
  unread: Record<string, UnreadNotification>,
  ptyIds: Iterable<string>,
): Record<string, UnreadNotification> {
  let next: Record<string, UnreadNotification> | null = null;
  for (const id of ptyIds) {
    if (id in (next ?? unread)) {
      next ??= { ...unread };
      delete next[id];
    }
  }
  return next ?? unread;
}

/** All leaves across every tab bound to `cwd`. */
function leavesForCwd(tabs: Tab[], cwd: string): PaneLeaf[] {
  return tabs.filter((t) => t.cwd === cwd).flatMap((t) => leaves(t.root));
}

export const createTabsSlice: StateCreator<TabsSlice, [], [], TabsSlice> = (set, get) => ({
  tabs: [],
  activeTabId: null,
  tabsByCwd: {},
  unreadByPtyId: {},

  addTab: ({ ptyId, cwd, title }) => {
    const id = ptyId; // ptyId is already a uuid; reuse as tab id.
    const now = Date.now();
    const leaf = makeLeaf({ ptyId, cwd, title: title ?? basename(cwd), createdAt: now });
    const tab: Tab = {
      id,
      cwd,
      title: title ?? basename(cwd),
      root: leaf,
      focusedPaneId: leaf.id,
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
      const unreadByPtyId = clearUnreadFor(
        s.unreadByPtyId,
        leaves(removed.root).map((l) => l.ptyId),
      );
      return { tabs, tabsByCwd, activeTabId, unreadByPtyId };
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
      // Focusing a tab acknowledges every notification on it.
      const unreadByPtyId = clearUnreadFor(
        s.unreadByPtyId,
        leaves(tab.root).map((l) => l.ptyId),
      );
      return {
        tabs,
        activeTabId: id,
        tabsByCwd: { ...s.tabsByCwd, [tab.cwd]: reordered },
        unreadByPtyId,
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

  splitFocusedPane: (tabId, dir, leafInput) =>
    set((s) => {
      const tab = s.tabs.find((t) => t.id === tabId);
      if (!tab) return s;
      const newLeaf = makeLeaf({
        ptyId: leafInput.ptyId,
        cwd: leafInput.cwd,
        title: leafInput.title,
      });
      const root = splitPane(tab.root, tab.focusedPaneId, dir, newLeaf);
      const tabs = s.tabs.map((t) =>
        t.id === tabId ? { ...t, root, focusedPaneId: newLeaf.id } : t,
      );
      return { tabs };
    }),

  removePane: (tabId, paneId) => {
    let nextActive: string | null = null;
    set((s) => {
      const tab = s.tabs.find((t) => t.id === tabId);
      if (!tab) return s;
      const removedPty = findLeaf(tab.root, paneId)?.ptyId;
      const nextRoot = removePaneFromTree(tab.root, paneId);

      // Tab emptied: fall through to whole-tab removal semantics.
      if (nextRoot === null) {
        const tabs = s.tabs.filter((t) => t.id !== tabId);
        const cwdList = (s.tabsByCwd[tab.cwd] ?? []).filter((x) => x !== tabId);
        const tabsByCwd = { ...s.tabsByCwd };
        if (cwdList.length === 0) delete tabsByCwd[tab.cwd];
        else tabsByCwd[tab.cwd] = cwdList;
        let activeTabId = s.activeTabId;
        if (s.activeTabId === tabId) activeTabId = cwdList[0] ?? tabs[0]?.id ?? null;
        nextActive = activeTabId;
        const unreadByPtyId = clearUnreadFor(
          s.unreadByPtyId,
          leaves(tab.root).map((l) => l.ptyId),
        );
        return { tabs, tabsByCwd, activeTabId, unreadByPtyId };
      }

      // Pane removed but tab survives: re-focus a neighbour of the removed pane.
      const focusedPaneId =
        focusAfterRemoval(tab.root, paneId) ?? leaves(nextRoot)[0]?.id ?? tab.focusedPaneId;
      const tabs = s.tabs.map((t) =>
        t.id === tabId ? { ...t, root: nextRoot, focusedPaneId } : t,
      );
      const unreadByPtyId = removedPty
        ? clearUnreadFor(s.unreadByPtyId, [removedPty])
        : s.unreadByPtyId;
      return { tabs, unreadByPtyId };
    });
    return nextActive;
  },

  setFocusedPane: (tabId, paneId) =>
    set((s) => {
      const tab = s.tabs.find((t) => t.id === tabId);
      const leaf = tab ? findLeaf(tab.root, paneId) : null;
      if (!tab || !leaf) return s;
      // Even when focus doesn't move, looking at the pane clears its unread.
      const unreadByPtyId = clearUnreadFor(s.unreadByPtyId, [leaf.ptyId]);
      if (tab.focusedPaneId === paneId) {
        return unreadByPtyId === s.unreadByPtyId ? s : { unreadByPtyId };
      }
      const tabs = s.tabs.map((t) => (t.id === tabId ? { ...t, focusedPaneId: paneId } : t));
      return { tabs, unreadByPtyId };
    }),

  setPaneSizes: (tabId, splitId, sizes) =>
    set((s) => {
      const tab = s.tabs.find((t) => t.id === tabId);
      if (!tab) return s;
      const root = setSizes(tab.root, splitId, sizes);
      const tabs = s.tabs.map((t) => (t.id === tabId ? { ...t, root } : t));
      return { tabs };
    }),

  applyStatusUpdates: (updates) =>
    set((s) => {
      if (updates.length === 0) return s;
      const byPtyId = new Map<string, TerminalStatusUpdate>();
      for (const u of updates) byPtyId.set(u.ptyId, u);
      let anyChange = false;
      const tabs = s.tabs.map((t) => {
        // Skip tabs whose panes none of these updates touch.
        if (!leaves(t.root).some((l) => byPtyId.has(l.ptyId))) return t;
        anyChange = true;
        const root = mapLeaves(t.root, (l) => {
          const u = byPtyId.get(l.ptyId);
          if (!u) return l;
          return { ...l, status: u.status, foregroundCmd: u.foregroundCmd };
        });
        return { ...t, root };
      });
      return anyChange ? { tabs } : s;
    }),

  worktreeStatus: (cwd) => {
    const statuses = leavesForCwd(get().tabs, cwd).map((l) => l.status);
    if (statuses.length === 0) return null;
    if (statuses.includes('running')) return 'running';
    if (statuses.includes('idle')) return 'idle';
    if (statuses.includes('exited')) return 'exited';
    return null;
  },

  markNotification: (ptyId, text) =>
    set((s) => {
      // Always register: the signal means "this agent is waiting on you", so it
      // should light up even on the pane you're watching. It reads as a "your
      // turn" cue and clears the moment you engage the pane (setFocusedPane).
      // Ignored only if the pane no longer exists.
      if (!s.tabs.some((t) => findLeafByPty(t.root, ptyId))) return s;
      return {
        unreadByPtyId: { ...s.unreadByPtyId, [ptyId]: { text, at: Date.now() } },
      };
    }),

  clearUnread: (ptyId) =>
    set((s) => {
      const unreadByPtyId = clearUnreadFor(s.unreadByPtyId, [ptyId]);
      return unreadByPtyId === s.unreadByPtyId ? s : { unreadByPtyId };
    }),

  cwdHasUnread: (cwd) => {
    const { unreadByPtyId } = get();
    if (Object.keys(unreadByPtyId).length === 0) return false;
    return leavesForCwd(get().tabs, cwd).some((l) => l.ptyId in unreadByPtyId);
  },

  tabHasUnread: (tabId) => {
    const { unreadByPtyId, tabs } = get();
    if (Object.keys(unreadByPtyId).length === 0) return false;
    const tab = tabs.find((t) => t.id === tabId);
    return tab ? leaves(tab.root).some((l) => l.ptyId in unreadByPtyId) : false;
  },

  mostRecentUnread: () => {
    const { unreadByPtyId, tabs } = get();
    let best: { ptyId: string; tabId: string; paneId: string; at: number } | null = null;
    for (const [ptyId, info] of Object.entries(unreadByPtyId)) {
      for (const tab of tabs) {
        const leaf = findLeafByPty(tab.root, ptyId);
        if (!leaf) continue;
        if (!best || info.at > best.at) {
          best = { ptyId, tabId: tab.id, paneId: leaf.id, at: info.at };
        }
        break;
      }
    }
    return best ? { ptyId: best.ptyId, tabId: best.tabId, paneId: best.paneId } : null;
  },
});
