// Wires IPC events from the preload bridge into the Zustand store. Call
// `attachIpc(store)` once at startup; it returns an unsubscribe.
import { useStore } from '../store';
import { refreshChangedFiles } from '../actions/editor';

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

  // Untracked repos noticed via PTY cwds — surfaced as a toast.
  unsubs.push(
    api.repos.onDiscovered((e) => {
      useStore.getState().enqueueDiscovery(e);
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
