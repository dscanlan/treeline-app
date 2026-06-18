// Tab-orchestration helpers shared by Sidebar clicks, the + button, and the
// close button. Keeps the IPC dance out of the components.
import type { SplitDirection } from '@shared/pane-tree';
import { findLeaf } from '@shared/pane-tree';
import { useStore } from '../store';

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

export async function closeTab(id: string): Promise<void> {
  const s = useStore.getState();
  const tab = s.tabs.find((t) => t.id === id);
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
