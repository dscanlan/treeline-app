// Pure conversions between the live tab tree (Tab/PaneNode) and the serializable
// PersistedSession written to disk. No React, no store, no IO — reused by the
// save path (toPersistedSession, renderer) and the cold-start restore path
// (persistedToLiveTree, renderer). Lives in `shared/` (like `pane-tree.ts`) so
// the node tsconfig can typecheck `tests/session-serialize.test.ts`.

import type {
  PersistedLeaf,
  PersistedNode,
  PersistedSession,
  PersistedTab,
  Tab,
} from './types';
import { leaves, makeLeaf, type PaneNode } from './pane-tree';

/**
 * A pane was a "Claude pane" iff its foreground command was `claude` at save.
 * For those, pin the session id resolved for the pane's cwd (`sessionIdByCwd`)
 * so restore resumes that exact conversation instead of re-deriving the newest
 * one later. `sessionIdByCwd` is empty when the caller couldn't (or didn't) look
 * ids up — restore then falls back to a fresh look-up.
 */
function toPersistedNode(node: PaneNode, sessionIdByCwd: Map<string, string>): PersistedNode {
  if (node.kind === 'leaf') {
    const claudePane = node.foregroundCmd === 'claude';
    const claudeSessionId = claudePane ? sessionIdByCwd.get(node.cwd) : undefined;
    return {
      kind: 'leaf',
      id: node.id,
      cwd: node.cwd,
      title: node.title,
      claudePane,
      ...(claudeSessionId ? { claudeSessionId } : {}),
    };
  }
  return {
    kind: 'split',
    id: node.id,
    direction: node.direction,
    children: node.children.map((c) => toPersistedNode(c, sessionIdByCwd)),
    sizes: [...node.sizes],
  };
}

function toPersistedTab(tab: Tab, sessionIdByCwd: Map<string, string>): PersistedTab {
  return {
    id: tab.id,
    cwd: tab.cwd,
    title: tab.title,
    root: toPersistedNode(tab.root, sessionIdByCwd),
    focusedPaneId: tab.focusedPaneId,
  };
}

/**
 * Snapshot the current tabs into the on-disk shape (drops runtime-only fields).
 * `sessionIdByCwd` pins each Claude pane's session id by its cwd; pass an empty
 * map to skip pinning (restore falls back to resolving the id on the fly).
 */
export function toPersistedSession(
  tabs: Tab[],
  activeTabId: string | null,
  sessionIdByCwd: Map<string, string> = new Map(),
): PersistedSession {
  return {
    version: 1,
    tabs: tabs.map((t) => toPersistedTab(t, sessionIdByCwd)),
    activeTabId,
  };
}

/** The distinct cwds of every Claude pane across `tabs` (for save-time id pinning). */
export function claudePaneCwds(tabs: Tab[]): string[] {
  const cwds = new Set<string>();
  for (const t of tabs) {
    for (const leaf of leaves(t.root)) {
      if (leaf.foregroundCmd === 'claude') cwds.add(leaf.cwd);
    }
  }
  return [...cwds];
}

/** Every leaf of a persisted tree, in document order. */
export function persistedLeaves(node: PersistedNode): PersistedLeaf[] {
  return node.kind === 'leaf' ? [node] : node.children.flatMap(persistedLeaves);
}

/**
 * Rebuild a live pane tree from a persisted one, wiring each leaf to its freshly
 * spawned PTY via `ptyByLeafId` (persisted leaf id → new pty id). Node ids and
 * split sizes are kept verbatim so the layout — and the saved `focusedPaneId` —
 * survive. Leaves come back `status: 'running'` with no foreground command; the
 * status monitor corrects both once the shell reports in.
 */
export function persistedToLiveTree(
  node: PersistedNode,
  ptyByLeafId: Map<string, string>,
): PaneNode {
  if (node.kind === 'leaf') {
    return makeLeaf({
      id: node.id,
      ptyId: ptyByLeafId.get(node.id) ?? '',
      cwd: node.cwd,
      title: node.title,
      status: 'running',
    });
  }
  return {
    kind: 'split',
    id: node.id,
    direction: node.direction,
    children: node.children.map((c) => persistedToLiveTree(c, ptyByLeafId)),
    sizes: [...node.sizes],
  };
}

/** Rebuild the cwd → tab-ids MRU index from a flat tab list (restore-time). */
export function rebuildTabsByCwd(tabs: Tab[]): Record<string, string[]> {
  const byCwd: Record<string, string[]> = {};
  for (const t of tabs) (byCwd[t.cwd] ??= []).push(t.id);
  return byCwd;
}
