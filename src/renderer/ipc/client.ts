// Wires IPC events from the preload bridge into the Zustand store. Call
// `attachIpc(store)` once at startup; it returns an unsubscribe.
import { useStore } from '../store';
import { refreshChangedFiles } from '../actions/editor';
import { openTabAt } from '../actions/tabs';
import { findLeaf } from '@shared/pane-tree';

export function attachIpc(): () => void {
  const api = window.treeline;
  const unsubs: Array<() => void> = [];

  // Worktree changes from the main process — reload that repo's worktrees, and
  // refresh the changed-file list for any of them currently shown in Changed
  // view so the Source-Control list stays live as files change.
  unsubs.push(
    api.worktrees.onChange((repoPath) => {
      void api.worktrees.list(repoPath).then((wts) => {
        const s = useStore.getState();
        s.setWorktrees(repoPath, wts);
        for (const wt of wts) {
          if (s.expandedDirs[wt.path] && s.worktreeFileView[wt.path] === 'changed') {
            void refreshChangedFiles(wt.path);
          }
        }
      });
    }),
  );

  // Process snapshots — main computes the worktree-path index and ships both.
  unsubs.push(
    api.processes.subscribe((snap) => {
      useStore.getState().setProcesses(snap.procs, snap.byWorktreePath);
    }),
  );

  // Per-PTY status deltas.
  unsubs.push(
    api.terminalStatus.subscribe((updates) => {
      useStore.getState().applyStatusUpdates(updates);
    }),
  );

  // Sidebar toggle from the macOS menu (CmdOrCtrl+B).
  unsubs.push(
    api.window.onSidebarToggle(() => {
      const s = useStore.getState();
      const next = !s.sidebarCollapsed;
      s.setSidebarCollapsed(next);
      void api.config.setSidebarCollapsed(next);
    }),
  );

  // Embedded browser pane toggle from the macOS menu (CmdOrCtrl+Shift+B).
  unsubs.push(
    api.window.onBrowserToggle(() => {
      useStore.getState().toggleBrowserPanel();
    }),
  );

  // Untracked repos noticed via PTY cwds — surfaced as a toast.
  unsubs.push(
    api.repos.onDiscovered((e) => {
      useStore.getState().enqueueDiscovery(e);
    }),
  );

  // Commands forwarded from the scriptable CLI socket (main resolves the verb
  // to a concrete worktree cwd; here we open/focus its tab, reusing the same
  // path a sidebar click takes so GUI and CLI behaviour stay identical).
  unsubs.push(
    api.cli.onCommand((cmd) => {
      if (cmd.verb === 'open') {
        void openTabAt(cmd.cwd);
      } else if (cmd.verb === 'send') {
        // Type into the focused terminal, reusing the same PTY write path as a
        // keystroke. No-op if no tab is active.
        const s = useStore.getState();
        const tab = s.tabs.find((t) => t.id === s.activeTabId);
        // A tab is now a pane tree; write to the focused pane's PTY.
        const leaf = tab ? findLeaf(tab.root, tab.focusedPaneId) : null;
        if (leaf) api.pty.write(leaf.ptyId, cmd.text);
      }
    }),
  );

  // Dev-only: state hydration for the screenshot harness. Production main
  // never sends to this channel, so the listener is dead weight outside
  // `scripts/take-screenshots-auto.sh`.
  unsubs.push(
    api.screenshot.onHydrate((p) => {
      if (p.reset) {
        try {
          localStorage.clear();
        } catch {
          /* ignore */
        }
        useStore.setState({
          repos: [],
          worktreesByRepo: {},
          selectedSidebarPath: null,
          selectedScratchId: null,
          pendingDiscoveries: [],
          filter: '',
          sidebarCollapsed: false,
          modal: null,
          tabs: [],
          activeTabId: null,
          tabsByCwd: {},
          processes: [],
          processesByWorktreePath: {},
          forceTooltip: null,
          scratches: [],
          expandedDirs: {},
          dirChildren: {},
          worktreeFileView: {},
          changedByWorktree: {},
          changedLoading: {},
          codePanelOpen: false,
          openFilePath: null,
          panelMode: 'file',
          openFileText: null,
          openDiff: null,
          editing: false,
          draft: null,
          saving: false,
          saveError: null,
          browserPanelOpen: false,
        });
      }
      const s = useStore.getState();
      if (p.repos) s.setRepos(p.repos);
      if (p.worktreesByRepo) {
        for (const [path, wts] of Object.entries(p.worktreesByRepo)) {
          s.setWorktrees(path, wts);
        }
      }
      if (p.pendingDiscoveries) {
        // Bypass enqueueDiscovery's persistence — the harness wants a clean
        // single-toast state, not whatever was saved last session.
        useStore.setState({ pendingDiscoveries: p.pendingDiscoveries });
      }
      if (p.selected !== undefined) s.setSelected(p.selected);
      if (p.filter !== undefined) s.setFilter(p.filter);
      if (p.sidebarCollapsed !== undefined) s.setSidebarCollapsed(p.sidebarCollapsed);
      if (p.scratches !== undefined) {
        // Replace wholesale — addScratch would append on top of any prior
        // state; harness scenarios always start with `reset: true` so the
        // hydrate intent is "this is the full set".
        useStore.setState({ scratches: p.scratches });
      }
      if (p.selectedScratchId !== undefined) s.setSelectedScratch(p.selectedScratchId);
      if (p.modal !== undefined) {
        if (p.modal === null) s.closeModal();
        else s.openModal(p.modal);
      }
      if (p.tabs) {
        // Build the by-cwd index from scratch so `worktreeStatus()` lookups
        // see the synthesised tabs immediately. Manual set bypasses the
        // tabs-slice's MRU bookkeeping (irrelevant here — the harness
        // controls the active tab explicitly via activeTabId).
        const tabsByCwd: Record<string, string[]> = {};
        for (const t of p.tabs) {
          (tabsByCwd[t.cwd] ??= []).unshift(t.id);
        }
        useStore.setState({ tabs: p.tabs, tabsByCwd });
      }
      if (p.activeTabId !== undefined) {
        useStore.setState({ activeTabId: p.activeTabId });
      }
      if (p.processesByWorktreePath !== undefined) {
        const flat = Object.values(p.processesByWorktreePath).flat();
        s.setProcesses(flat, p.processesByWorktreePath);
      }
      if (p.terminalStatus) {
        s.applyStatusUpdates(p.terminalStatus);
      }
      if (p.forceTooltipNear !== undefined) {
        s.setForceTooltip(
          p.forceTooltipNear === null ? null : p.forceTooltipNear,
        );
      }
      // Code-viewer state — set directly (the slice's setters are granular and
      // the harness wants a wholesale snapshot).
      const editor: Record<string, unknown> = {};
      if (p.expandedDirs !== undefined) editor.expandedDirs = p.expandedDirs;
      if (p.dirChildren !== undefined) editor.dirChildren = p.dirChildren;
      if (p.worktreeFileView !== undefined) editor.worktreeFileView = p.worktreeFileView;
      if (p.changedByWorktree !== undefined) editor.changedByWorktree = p.changedByWorktree;
      if (p.codePanelOpen !== undefined) editor.codePanelOpen = p.codePanelOpen;
      if (p.codePanelWidth !== undefined) editor.codePanelWidth = p.codePanelWidth;
      if (p.openFilePath !== undefined) editor.openFilePath = p.openFilePath;
      if (p.panelMode !== undefined) editor.panelMode = p.panelMode;
      if (p.openFileText !== undefined) editor.openFileText = p.openFileText;
      if (p.openDiff !== undefined) editor.openDiff = p.openDiff;
      if (p.editing !== undefined) editor.editing = p.editing;
      if (p.draft !== undefined) editor.draft = p.draft;
      if (p.saveError !== undefined) editor.saveError = p.saveError;
      if (Object.keys(editor).length > 0) useStore.setState(editor);

      // Embedded-browser pane — set directly so the harness can open the
      // <webview> and seed its address bar / nav state for the Browser shot.
      const browser: Record<string, unknown> = {};
      if (p.browserPanelOpen !== undefined) browser.browserPanelOpen = p.browserPanelOpen;
      if (p.browserPanelWidth !== undefined) browser.browserPanelWidth = p.browserPanelWidth;
      if (p.browserSrc !== undefined) {
        browser.browserSrc = p.browserSrc;
        // Default the address bar to the committed src unless overridden below.
        browser.browserAddress = p.browserSrc;
      }
      if (p.browserAddress !== undefined) browser.browserAddress = p.browserAddress;
      if (p.browserTitle !== undefined) browser.browserTitle = p.browserTitle;
      if (p.browserCanGoBack !== undefined) browser.browserCanGoBack = p.browserCanGoBack;
      if (p.browserCanGoForward !== undefined) browser.browserCanGoForward = p.browserCanGoForward;
      if (Object.keys(browser).length > 0) useStore.setState(browser);
    }),
  );

  return () => unsubs.forEach((fn) => fn());
}

/** Hydrate initial state from disk + main: config, repos, worktrees. */
export async function loadInitialState(): Promise<void> {
  const api = window.treeline;
  const cfg = await api.config.get();
  useStore.getState().setRepos(cfg.repos);
  useStore.getState().setSidebarCollapsed(cfg.sidebarCollapsed);

  // Fetch worktrees for each repo in parallel.
  await Promise.all(
    cfg.repos.map(async (repo) => {
      try {
        const wts = await api.worktrees.list(repo.path);
        useStore.getState().setWorktrees(repo.path, wts);
      } catch (err) {
        console.error('failed to load worktrees for', repo.path, err);
      }
    }),
  );
}
