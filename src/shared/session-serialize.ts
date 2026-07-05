// Pure conversions between the live tab tree (Tab/PaneNode) and the serializable
// PersistedSession written to disk. No React, no store, no IO — reused by the
// save path (toPersistedSession, renderer) and the cold-start restore path
// (persistedToLiveTree, renderer). Lives in `shared/` (like `pane-tree.ts`) so
// the node tsconfig can typecheck `tests/session-serialize.test.ts`.

import { KIND_BY_BASENAME, type AgentKind } from './agents';
import type {
  PersistedLeaf,
  PersistedNode,
  PersistedSession,
  PersistedTab,
  Tab,
} from './types';
import { leaves, makeLeaf, type PaneNode } from './pane-tree';

/**
 * A pane's session id as pinned in PtyManager: the id an agent's session-start
 * hook reported, tagged with the kind it was reported under so a pin recorded
 * for one agent is never applied to a pane now running another.
 */
export interface PinnedAgentSession {
  kind: AgentKind;
  sessionId: string;
}

/**
 * A pane is an "agent pane" iff its foreground command mapped to a registry
 * kind at save (via KIND_BY_BASENAME). For those, pin the session id so
 * restore resumes that exact conversation instead of re-deriving the newest
 * one later. `sessionIdByPane` (keyed by the live pty id, reported by the
 * agent's session-start hook) identifies the pane's ACTUAL session and wins —
 * but only when its recorded kind matches the pane's current agent.
 * `sessionIdByCwd` (newest transcript for the directory — Claude-only until
 * other agents grow session stores) is the fallback for claude panes with no
 * reported id; it can't tell two panes in the same cwd apart. Both empty → no
 * pin; restore then falls back to a fresh look-up.
 */
function toPersistedNode(
  node: PaneNode,
  sessionIdByCwd: Map<string, string>,
  sessionIdByPane: Map<string, PinnedAgentSession>,
): PersistedNode {
  if (node.kind === 'leaf') {
    const agentKind = node.foregroundCmd ? KIND_BY_BASENAME[node.foregroundCmd] : undefined;
    const pinned = sessionIdByPane.get(node.ptyId);
    const agentSessionId = agentKind
      ? pinned && pinned.kind === agentKind
        ? pinned.sessionId
        : agentKind === 'claude'
          ? sessionIdByCwd.get(node.cwd)
          : undefined
      : undefined;
    return {
      kind: 'leaf',
      id: node.id,
      cwd: node.cwd,
      title: node.title,
      ...(agentKind ? { agentKind } : {}),
      ...(agentSessionId ? { agentSessionId } : {}),
    };
  }
  return {
    kind: 'split',
    id: node.id,
    direction: node.direction,
    children: node.children.map((c) => toPersistedNode(c, sessionIdByCwd, sessionIdByPane)),
    sizes: [...node.sizes],
  };
}

function toPersistedTab(
  tab: Tab,
  sessionIdByCwd: Map<string, string>,
  scratchPtyIds: Set<string>,
  sessionIdByPane: Map<string, PinnedAgentSession>,
): PersistedTab {
  // A scratch terminal is an unsplit tab whose sole pane is a known scratch PTY.
  // A scratch the user split is no longer represented in the scratch slice, so
  // it round-trips as a plain tab — matching the live model.
  const isScratch = tab.root.kind === 'leaf' && scratchPtyIds.has(tab.root.ptyId);
  return {
    id: tab.id,
    cwd: tab.cwd,
    title: tab.title,
    root: toPersistedNode(tab.root, sessionIdByCwd, sessionIdByPane),
    focusedPaneId: tab.focusedPaneId,
    ...(isScratch ? { scratch: true } : {}),
  };
}

/**
 * Snapshot the current tabs into the on-disk shape (drops runtime-only fields).
 * `sessionIdByPane` pins each agent pane's session id by its live pty id (the
 * id its session-start hook reported, kind-tagged — exact even when panes
 * share a cwd); `sessionIdByCwd` is the per-directory fallback for claude
 * panes with no reported id. Pass empty maps to skip pinning (restore falls
 * back to resolving the id on the fly). `scratchPtyIds` flags which tabs were
 * scratch terminals so restore can re-seed the (memory-only) scratch slice;
 * pass an empty set to skip flagging.
 */
export function toPersistedSession(
  tabs: Tab[],
  activeTabId: string | null,
  sessionIdByCwd: Map<string, string> = new Map(),
  scratchPtyIds: Set<string> = new Set(),
  sessionIdByPane: Map<string, PinnedAgentSession> = new Map(),
): PersistedSession {
  return {
    version: 1,
    tabs: tabs.map((t) => toPersistedTab(t, sessionIdByCwd, scratchPtyIds, sessionIdByPane)),
    activeTabId,
  };
}

/**
 * The distinct cwds of every pane whose foreground command maps to `kind` (for
 * save-time id pinning). Panes whose pty is in `pinnedPtyIds` already carry an
 * exact per-pane id, so their cwds don't need the newest-session fallback
 * look-up.
 */
export function agentPaneCwds(
  tabs: Tab[],
  kind: AgentKind,
  pinnedPtyIds: Set<string> = new Set(),
): string[] {
  const cwds = new Set<string>();
  for (const t of tabs) {
    for (const leaf of leaves(t.root)) {
      const leafKind = leaf.foregroundCmd ? KIND_BY_BASENAME[leaf.foregroundCmd] : undefined;
      if (leafKind === kind && !pinnedPtyIds.has(leaf.ptyId)) cwds.add(leaf.cwd);
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
