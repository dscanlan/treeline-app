// Wires IPC events from the preload bridge into the Zustand store. Call
// `attachIpc(store)` once at startup; it returns an unsubscribe.
import { useStore } from '../store';

export function attachIpc(): () => void {
  const api = window.treeline;
  const unsubs: Array<() => void> = [];

  // Worktree changes from the main process — reload that repo's worktrees.
  unsubs.push(
    api.worktrees.onChange((repoPath) => {
      void api.worktrees.list(repoPath).then((wts) => {
        useStore.getState().setWorktrees(repoPath, wts);
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
