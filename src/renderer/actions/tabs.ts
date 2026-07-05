// Tab-orchestration helpers shared by Sidebar clicks, the + button, and the
// close button. Keeps the IPC dance out of the components.
import { AGENTS, buildRestoreCommand, type AgentKind } from '@shared/agents';
import type { SplitDirection } from '@shared/pane-tree';
import { findLeaf } from '@shared/pane-tree';
import type { PersistedSession, Scratch, Tab } from '@shared/types';
import {
  persistedLeaves,
  persistedToLiveTree,
  rebuildTabsByCwd,
} from '@shared/session-serialize';
import { useStore } from '../store';
import { registerScratchCleanup } from './scratch';

interface OpenOpts {
  /** If true, always spawn a fresh tab instead of focusing the MRU on this cwd. */
  forceNew?: boolean;
}

export async function openTabAt(cwd: string, opts: OpenOpts = {}): Promise<void> {
  const s = useStore.getState();
  const existing = s.tabsByCwd[cwd]?.[0];
  if (!opts.forceNew && existing) {
    s.setActive(existing);
    s.setSelected(cwd);
    return;
  }
  // Spawn a new PTY in the main process. Initial size is updated by FitAddon
  // immediately after mount, so the 80x24 default is fine.
  const { id } = await window.treeline.pty.spawn({ cwd, cols: 80, rows: 24 });
  s.addTab({ ptyId: id, cwd });
  s.setSelected(cwd);
}

/**
 * Open (or focus) a terminal in a worktree a tab drifted into, then clear any
 * drift prompts pointing at it. Shared by the drift toast and the tab chip.
 */
export async function openDriftedWorktree(toWorktree: string): Promise<void> {
  await openTabAt(toWorktree);
  useStore.getState().dismissWorktreeOpen(toWorktree);
}

/**
 * Run `data` against the freshly-spawned PTY `id` once its shell is ready.
 * A login shell prints its prompt asynchronously, and typing before that can be
 * swallowed by a redraw — so we wait for the first byte of output (the prompt),
 * with a timeout fallback in case the shell stays silent.
 */
function writeWhenReady(id: string, data: string): void {
  let fired = false;
  const fire = (): void => {
    if (fired) return;
    fired = true;
    clearTimeout(timer);
    unsub();
    window.treeline.pty.write(id, data);
  };
  const unsub = window.treeline.pty.onData(id, fire);
  const timer = setTimeout(fire, 1500);
}

/**
 * Restore a saved tab layout after a full restart (auto-update relaunch / reboot)
 * where no PTYs survived. For each saved tab whose worktree still exists, we
 * respawn one fresh shell per pane, rebuild the split tree around the new PTYs
 * (layout + focus preserved), and re-run the saved agent's resume command in
 * any pane that was running one — via the registry's resume capability, with
 * the id resolved from disk when not pinned. An agent with no resume
 * capability restores as a plain shell at the saved cwd. Tabs whose worktree
 * was removed while the app was closed are skipped and counted. Commits the
 * whole tab set in one `setState`, then surfaces a "Restored N tabs" toast.
 * Only ever called from the user's Restore confirmation.
 */
export async function restoreSession(saved: PersistedSession): Promise<void> {
  const api = window.treeline;
  const builtTabs: Tab[] = [];
  const agentResumes: {
    ptyId: string;
    cwd: string;
    kind: AgentKind;
    sessionId?: string;
  }[] = [];
  const restoredScratches: Scratch[] = [];
  let skipped = 0;

  for (const ptab of saved.tabs) {
    // Skip a tab whose worktree no longer exists — respawning there would land
    // the shell somewhere surprising (or fail).
    if (!(await api.system.pathExists(ptab.cwd).catch(() => false))) {
      skipped++;
      continue;
    }

    // Spawn one PTY per leaf, mapping persisted leaf id → new pty id so the tree
    // can be rebuilt with live PTYs while keeping node ids (and focus) intact.
    const ptyByLeafId = new Map<string, string>();
    for (const leaf of persistedLeaves(ptab.root)) {
      const { id: ptyId } = await api.pty.spawn({ cwd: leaf.cwd, cols: 80, rows: 24 });
      ptyByLeafId.set(leaf.id, ptyId);
      // Prefer the id pinned at save time; fall back to resolving it now.
      // Capability-gated: a kind with no resume entry respawns as a plain
      // shell (skipped here), same as any non-agent pane.
      if (leaf.agentKind && AGENTS[leaf.agentKind].resume) {
        agentResumes.push({
          ptyId,
          cwd: leaf.cwd,
          kind: leaf.agentKind,
          sessionId: leaf.agentSessionId,
        });
      }
    }

    const now = Date.now();
    builtTabs.push({
      id: ptab.id,
      cwd: ptab.cwd,
      title: ptab.title,
      root: persistedToLiveTree(ptab.root, ptyByLeafId),
      focusedPaneId: ptab.focusedPaneId,
      createdAt: now,
      lastActiveAt: now,
    });

    // Re-seed the (memory-only) scratch slice for a restored scratch tab. It's
    // always an unsplit single-leaf tab; its new PTY id keys the row, matching
    // openScratchTerminal's `id === ptyId` convention.
    if (ptab.scratch) {
      const leafId = persistedLeaves(ptab.root)[0]?.id;
      const ptyId = leafId ? ptyByLeafId.get(leafId) : undefined;
      if (ptyId) {
        restoredScratches.push({ id: ptyId, label: ptab.title, ptyId, cwd: ptab.cwd, createdAt: now });
      }
    }
  }

  // Commit the rebuilt tabs wholesale (mirrors the screenshot-hydrate path):
  // bypasses addTab's per-tab MRU bookkeeping, so we seed tabsByCwd ourselves.
  // Scratch rows go in the same commit so the sidebar reflects them at once;
  // we don't touch selectedScratchId — the active tab/selection is set above.
  const activeTabId = builtTabs.some((t) => t.id === saved.activeTabId)
    ? saved.activeTabId
    : (builtTabs[0]?.id ?? null);
  useStore.setState({
    tabs: builtTabs,
    activeTabId,
    tabsByCwd: rebuildTabsByCwd(builtTabs),
    scratches: restoredScratches,
  });

  // Wire each restored scratch's exit cleanup so typing `exit` (or closing the
  // tab) tears the row down exactly like a freshly-opened scratch.
  for (const sc of restoredScratches) registerScratchCleanup(sc.ptyId);

  // Resume each agent in its flagged panes once each shell is ready.
  // Best-effort and independent per pane: a missing session just leaves a
  // plain shell. Use the id pinned at save time when we have one; otherwise
  // resolve the newest now through the kind's session store (a kind with no
  // store resolves null and falls through to its id-less resume, if any).
  for (const { ptyId, cwd, kind, sessionId } of agentResumes) {
    const resume = (id: string | null): void => {
      const cmd = buildRestoreCommand(kind, id);
      if (cmd) writeWhenReady(ptyId, `${cmd}\r`);
    };
    if (sessionId) resume(sessionId);
    else void api.agentSession.latestForCwd(cwd, kind).then(resume, () => resume(null));
  }

  useStore.getState().noteRestored(builtTabs.length, skipped);
}

/**
 * Continue the parent repo's active agent conversation inside a newly-created
 * worktree. Asks main to copy the session into the worktree's store (agents
 * key sessions by directory, so this is the only way to resume the *same*
 * conversation there), opens a fresh terminal in the worktree, and runs the
 * registry's fork command (`resume.fork`) once its shell is ready — the fork
 * gives the worktree copy its own id so the original stays untouched.
 * Capability-gated: callers (the drift toast) only offer this for kinds with
 * both `resume.fork` and a copy-capable session store. Throws when there's no
 * session to resume, so callers can surface it.
 */
export async function resumeSessionInWorktree(
  toWorktree: string,
  kind: AgentKind = 'claude',
): Promise<void> {
  const label = AGENTS[kind].label;
  const prep = await window.treeline.agentSession.prepareResume(toWorktree, kind);
  if (!prep) throw new Error(`No ${label} session found in the parent repo to resume.`);

  const s = useStore.getState();

  // The origin pane to park: the MRU tab rooted at the parent repo, and its
  // focused pane — where the agent that created the worktree is running.
  const originTabId = s.tabsByCwd[prep.originCwd]?.[0] ?? null;
  const originTab = originTabId ? s.tabs.find((t) => t.id === originTabId) : null;
  const originPtyId = originTab
    ? (findLeaf(originTab.root, originTab.focusedPaneId)?.ptyId ?? null)
    : null;

  // A session can only be handed off to one worktree at a time. If the same
  // agent created several worktrees and we already resumed into one, the origin
  // pane is already SIGSTOP-parked with a handoff recorded against its pty. The
  // handoff map is keyed by origin pty, so resuming again would overwrite that
  // record — orphaning the first fork and letting the origin thaw while that
  // fork still runs (defeating the one-active-agent guarantee). Refuse here,
  // before spawning a second fork; the error surfaces in the toast.
  if (originPtyId) {
    const existing = s.handoffByOriginPty[originPtyId];
    if (existing) {
      const wt =
        existing.worktreeCwd.split('/').filter(Boolean).pop() ?? existing.worktreeCwd;
      throw new Error(
        `This Claude session is already continuing in ${wt}. Return to the original first to hand it off elsewhere.`,
      );
    }
  }

  // Spawn the worktree fork and resume the copied conversation in it. The
  // fork command comes from the kind's registry entry — validated like every
  // id typed into a shell.
  const forkCap = AGENTS[kind].resume;
  if (!forkCap?.fork || !forkCap.isValidSessionId(prep.sessionId)) {
    throw new Error(`No forkable ${label} session to continue in the worktree.`);
  }
  const { id: forkPty } = await window.treeline.pty.spawn({
    cwd: toWorktree,
    cols: 80,
    rows: 24,
  });
  const forkTabId = s.addTab({ ptyId: forkPty, cwd: toWorktree });
  s.setSelected(toWorktree);
  writeWhenReady(forkPty, `${forkCap.fork(prep.sessionId)}\r`);
  s.dismissWorktreeOpen(toWorktree);

  // Park the origin so the same conversation can't run in two places at once.
  // Best-effort: if we couldn't pin down the origin pane (e.g. the agent ran in
  // a terminal outside treeline), skip the freeze rather than guess wrong.
  if (originPtyId && originTabId) {
    const frozen = await window.treeline.pty.pause(originPtyId);
    if (frozen) {
      s.recordHandoff({
        originPtyId,
        originTabId,
        originCwd: prep.originCwd,
        worktreeCwd: toWorktree,
        forkTabId,
      });
    }
  }
}

/**
 * Undo a handoff: thaw the parked origin session and discard the worktree fork,
 * so work continues only in the original. Enforces the "one active agent"
 * guarantee — going back kills the fork rather than leaving both runnable.
 * No-op if `originPtyId` isn't currently parked.
 */
export async function returnToOriginal(originPtyId: string): Promise<void> {
  const s = useStore.getState();
  const handoff = s.handoffByOriginPty[originPtyId];
  if (!handoff) return;
  // Clear first so closeTab() below doesn't also try to thaw the origin.
  s.clearHandoff(originPtyId);
  await closeTab(handoff.forkTabId); // kills the fork's claude
  await window.treeline.pty.resume(originPtyId);
  s.setActive(handoff.originTabId);
  s.setSelected(handoff.originCwd);
}

export async function closeTab(id: string): Promise<void> {
  const s = useStore.getState();
  const tab = s.tabs.find((t) => t.id === id);

  // Keep session handoffs consistent when either side's tab closes:
  //  - closing the worktree fork abandons the handoff → thaw the parked origin.
  //  - closing the origin tab kills the parked pane → just drop the record.
  const forkHandoff = s.handoffForFork(id);
  if (forkHandoff) {
    s.clearHandoff(forkHandoff.originPtyId);
    void window.treeline.pty.resume(forkHandoff.originPtyId);
  }
  for (const h of Object.values(s.handoffByOriginPty)) {
    if (h.originTabId === id) s.clearHandoff(h.originPtyId);
  }

  s.removeTab(id);
  // Clear any drift prompts owned by this tab's panes — the terminal is gone.
  for (const p of tab ? leavesPtyIds(tab) : [id]) s.dismissDriftByPty(p);
  // Best-effort kill of every PTY the tab hosted; ignore errors (already
  // exited). A single-pane tab's pty id equals the tab id, but a split tab has
  // many panes — kill them all so we don't leak shells.
  const ptys = tab ? leavesPtyIds(tab) : [id];
  await Promise.all(
    ptys.map((p) =>
      window.treeline.pty.kill(p).catch(() => {
        /* ignore */
      }),
    ),
  );
}

/** All ptyIds a tab currently hosts. */
function leavesPtyIds(tab: { root: import('@shared/pane-tree').PaneNode }): string[] {
  // Local import-free walk to avoid pulling `leaves` just for the type dance.
  const out: string[] = [];
  const walk = (n: import('@shared/pane-tree').PaneNode): void => {
    if (n.kind === 'leaf') out.push(n.ptyId);
    else n.children.forEach(walk);
  };
  walk(tab.root);
  return out;
}

/**
 * Focus the most-recently-notified (unread) terminal: activate its tab, focus
 * its pane, and select its worktree in the sidebar. Both store actions clear the
 * pane's unread flag as a side effect. No-op when nothing is unread. Drives the
 * ⌘⇧U accelerator.
 */
export function jumpToMostRecentUnread(): void {
  const s = useStore.getState();
  const target = s.mostRecentUnread();
  if (!target) return;
  s.setActive(target.tabId);
  s.setFocusedPane(target.tabId, target.paneId);
  const tab = s.tabs.find((t) => t.id === target.tabId);
  if (tab) s.setSelected(tab.cwd);
}

/**
 * Split the focused pane of the active tab in `dir`. Spawns a new PTY that
 * inherits the focused pane's cwd (cmux-style), then wires it into the tree as
 * the new focused pane. No-op if there's no active tab.
 */
export async function splitFocusedPane(dir: SplitDirection): Promise<void> {
  const s = useStore.getState();
  const tab = s.tabs.find((t) => t.id === s.activeTabId);
  if (!tab) return;
  const focused = findLeaf(tab.root, tab.focusedPaneId);
  const cwd = focused?.cwd ?? tab.cwd;
  const title = focused?.title ?? tab.title;
  const { id: ptyId } = await window.treeline.pty.spawn({ cwd, cols: 80, rows: 24 });
  s.splitFocusedPane(tab.id, dir, { ptyId, cwd, title });
}

/**
 * Close the focused pane of the active tab. Kills its PTY and removes the leaf;
 * if that was the tab's last pane, the tab closes too. No-op if no active tab.
 */
export async function closeFocusedPane(): Promise<void> {
  const s = useStore.getState();
  const tab = s.tabs.find((t) => t.id === s.activeTabId);
  if (!tab) return;
  const focused = findLeaf(tab.root, tab.focusedPaneId);
  if (!focused) return;
  s.removePane(tab.id, focused.id);
  s.dismissDriftByPty(focused.ptyId);
  await window.treeline.pty.kill(focused.ptyId).catch(() => {
    /* ignore */
  });
}
