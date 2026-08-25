// Wires IPC events from the preload bridge into the Zustand store. Call
// `attachIpc(store)` once at startup; it returns an unsubscribe.
import { useStore } from '../store';
import { refreshChangedFiles, refreshPinnedFilesAvailability } from '../actions/editor';
import { openTabAt, jumpToMostRecentUnread } from '../actions/tabs';
import { toggleSidebar } from '../actions/sidebar';
import { registerScratchCleanup } from '../actions/scratch';
import { findLeaf, leaves } from '@shared/pane-tree';
import { DEFAULT_RENDERER_SETTINGS } from '../store/settings-slice';
import { agentPaneCwds, toPersistedSession } from '@shared/session-serialize';
import { createOpenFileState } from '../store/editor-slice';

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
      useStore.getState().setProcesses(snap.procs, snap.byWorktreePath, snap.portsByWorktreePath);
    }),
  );

  // GitHub PR status deltas, per repo — main polls `gh` and ships the full
  // branch→PR map for a repo whenever it changes.
  unsubs.push(
    api.pr.subscribe(({ repoPath, prByBranch }) => {
      useStore.getState().setPrInfo(repoPath, prByBranch);
    }),
  );

  // Per-PTY status deltas.
  unsubs.push(
    api.terminalStatus.subscribe((updates) => {
      useStore.getState().applyStatusUpdates(updates);
    }),
  );

  // Agent-attention notifications (OSC 9/99/777 from a terminal): mark the
  // raising pane unread so its ring/badge lights up.
  unsubs.push(
    api.pty.onNotification(({ id, text }) => {
      useStore.getState().markNotification(id, text);
    }),
  );

  // Sidebar toggle from the macOS menu (CmdOrCtrl+B).
  unsubs.push(api.window.onSidebarToggle(toggleSidebar));

  // Embedded browser pane toggle from the macOS menu (CmdOrCtrl+Shift+B). The
  // browser and scratchpad share the right-hand aux slot, so opening the browser
  // closes the scratchpad.
  unsubs.push(
    api.window.onBrowserToggle(() => {
      const s = useStore.getState();
      if (!s.browserPanelOpen) s.closeNotesPanel();
      s.toggleBrowserPanel();
    }),
  );

  // Scratchpad panel toggle from the macOS menu (CmdOrCtrl+Shift+N). Opening it
  // closes the browser (they share the right-hand aux slot).
  unsubs.push(
    api.window.onScratchpadToggle(() => {
      const s = useStore.getState();
      if (!s.notesPanelOpen) s.closeBrowserPanel();
      s.toggleNotesPanel();
    }),
  );

  // "Settings…" menu item / accelerator from the macOS menu.
  unsubs.push(
    api.window.onOpenSettings(() => {
      useStore.getState().openModal({ kind: 'settings' });
    }),
  );

  // "Jump to Unread Agent" menu item / accelerator (⌘⇧U) from the macOS menu.
  unsubs.push(
    api.window.onJumpToUnread(() => {
      jumpToMostRecentUnread();
    }),
  );

  // "Quick Open File…" (⌘P): fuzzy file finder scoped to the selected target.
  unsubs.push(
    api.window.onQuickOpenFile(() => {
      const root = resolveSearchRoot();
      if (root) useStore.getState().openModal({ kind: 'quick-open', root });
    }),
  );

  // "Find in Files…" (⌘⇧F): content search panel scoped to the selected target.
  // Always opens (the panel itself prompts if no target is resolvable).
  unsubs.push(
    api.window.onFindInFiles(() => {
      const root = resolveSearchRoot();
      const s = useStore.getState();
      if (root) s.openSearchPanel(root);
      else s.closeSearchPanel(); // nothing to scope to — don't open a dead panel
    }),
  );

  // Untracked repos noticed via PTY cwds — surfaced as a toast.
  unsubs.push(
    api.repos.onDiscovered((e) => {
      useStore.getState().enqueueDiscovery(e);
    }),
  );

  // A terminal's cwd drifted into a different worktree than its tab is rooted
  // in (manual `cd` in the shell) — offer to open a terminal there.
  unsubs.push(
    api.worktrees.onDrift((e) => {
      useStore
        .getState()
        .enqueueWorktreeOpen({ toWorktree: e.toWorktree, reason: 'drift', ptyId: e.ptyId });
    }),
  );

  // A new worktree was just created (e.g. an agent ran `git worktree add`) —
  // offer to open a terminal in it. This is the reliable signal for the
  // agent flow, where no shell cwd actually changes.
  unsubs.push(
    api.worktrees.onCreated((path) => {
      useStore.getState().enqueueWorktreeOpen({ toWorktree: path, reason: 'created' });
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
      } else if (cmd.verb === 'browser-navigate') {
        // Open the embedded browser pane and commit the URL as its src — the
        // same store action a port-chip click takes, so CLI and GUI agree.
        useStore.getState().openBrowserPanel(cmd.url);
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
          folders: [],
          worktreesByRepo: {},
          selectedSidebarPath: null,
          selectedScratchId: null,
          pendingDiscoveries: [],
          driftByWorktree: {},
          filter: '',
          sidebarMode: 'library',
          sidebarPins: [],
          sidebarCollapsedLocations: [],
          sidebarRepoOpen: {},
          sidebarFileRoot: null,
          sidebarAttentionOnly: false,
          sidebarCollapsed: false,
          modal: null,
          tabs: [],
          activeTabId: null,
          tabsByCwd: {},
          unreadByPtyId: {},
          handoffByOriginPty: {},
          processes: [],
          processesByWorktreePath: {},
          portsByWorktreePath: {},
          prByRepoBranch: {},
          forceTooltip: null,
          scratches: [],
          expandedDirs: {},
          dirChildren: {},
          worktreeFileView: {},
          changedByWorktree: {},
          changedLoading: {},
          pinnedFilePaths: [],
          missingPinnedFiles: {},
          codePanelOpen: false,
          openFilePaths: [],
          activeFilePath: null,
          openFilesByPath: {},
          viewerPanes: [],
          focusedViewerPaneId: 'primary',
          viewerSplitDirection: 'rows',
          viewerSplitRatio: 50,
          noteHistoryByPane: { primary: [], secondary: [] },
          browserPanelOpen: false,
        });
      }
      const s = useStore.getState();
      // Appearance (theme/font/keybindings): reset to factory defaults, then
      // apply any per-scenario override so theme + keybinding-conflict captures
      // are deterministic regardless of the machine's saved config.
      if (p.reset) s.setSettings(DEFAULT_RENDERER_SETTINGS);
      // A `reset` is meant to be a deterministic clean slate. The cold-start
      // bootstrap may have raised a "restore previous session?" prompt from
      // whatever session.json is on disk (e.g. a live dev instance sharing
      // userData); clear it so captures don't inherit it. Scenarios that want
      // the prompt set `pendingRestore` explicitly below, after this reset.
      if (p.reset) useStore.setState({ pendingRestore: null });
      if (p.settings) s.setSettings(p.settings);
      if (p.repos) s.setRepos(p.repos);
      if (p.folders) s.setFolders(p.folders);
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
      if (p.driftByWorktree) {
        // Bypass enqueueWorktreeOpen's tab-exists suppression — the harness
        // controls the exact toast state directly.
        useStore.setState({ driftByWorktree: p.driftByWorktree });
      }
      if (p.selected !== undefined) s.setSelected(p.selected);
      if (p.filter !== undefined) s.setFilter(p.filter);
      if (p.sidebarMode !== undefined) useStore.setState({ sidebarMode: p.sidebarMode });
      if (p.sidebarPins !== undefined) useStore.setState({ sidebarPins: p.sidebarPins });
      if (p.sidebarFileRoot !== undefined) {
        useStore.setState({ sidebarFileRoot: p.sidebarFileRoot });
      }
      if (p.sidebarAttentionOnly !== undefined) {
        useStore.setState({ sidebarAttentionOnly: p.sidebarAttentionOnly });
      }
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
      if (p.unreadByPtyId !== undefined) {
        useStore.setState({ unreadByPtyId: p.unreadByPtyId });
      }
      if (p.handoffByOriginPty !== undefined) {
        useStore.setState({ handoffByOriginPty: p.handoffByOriginPty });
      }
      if (p.reattachNotice !== undefined) {
        useStore.setState({ reattachNotice: p.reattachNotice });
      }
      if (p.pendingRestore !== undefined) {
        useStore.setState({ pendingRestore: p.pendingRestore });
      }
      if (p.processesByWorktreePath !== undefined) {
        const flat = Object.values(p.processesByWorktreePath).flat();
        s.setProcesses(flat, p.processesByWorktreePath, p.portsByWorktreePath ?? {});
      }
      if (p.prByRepoBranch !== undefined) {
        s.setAllPrInfo(p.prByRepoBranch);
      }
      if (p.terminalStatus) {
        s.applyStatusUpdates(p.terminalStatus);
      }
      if (p.forceTooltipNear !== undefined) {
        s.setForceTooltip(p.forceTooltipNear === null ? null : p.forceTooltipNear);
      }
      // Code-viewer state — set directly (the slice's setters are granular and
      // the harness wants a wholesale snapshot).
      const editor: Record<string, unknown> = {};
      if (p.expandedDirs !== undefined) editor.expandedDirs = p.expandedDirs;
      if (p.dirChildren !== undefined) editor.dirChildren = p.dirChildren;
      if (p.worktreeFileView !== undefined) editor.worktreeFileView = p.worktreeFileView;
      if (p.changedByWorktree !== undefined) editor.changedByWorktree = p.changedByWorktree;
      if (p.pinnedFilePaths !== undefined) editor.pinnedFilePaths = p.pinnedFilePaths;
      if (p.missingPinnedFiles !== undefined) {
        editor.missingPinnedFiles = Object.fromEntries(
          p.missingPinnedFiles.map((path) => [path, true]),
        );
      }
      if (p.codePanelOpen !== undefined) editor.codePanelOpen = p.codePanelOpen;
      if (p.codePanelWidth !== undefined) editor.codePanelWidth = p.codePanelWidth;
      if (p.openFiles !== undefined) {
        const openFilesByPath = Object.fromEntries(
          p.openFiles.map((seed) => {
            const file = createOpenFileState(seed.path, seed.panelMode ?? 'file');
            file.fileText = seed.fileText ?? null;
            file.fileTruncated = seed.fileTruncated ?? false;
            file.fileBinary = seed.fileBinary ?? false;
            file.diff = seed.diff ?? null;
            file.editing = seed.editing ?? false;
            file.draft = seed.draft ?? null;
            file.saveError = seed.saveError ?? null;
            return [seed.path, file];
          }),
        );
        editor.openFilePaths = p.openFiles.map((file) => file.path);
        editor.openFilesByPath = openFilesByPath;
        const activeFilePath = p.activeFilePath ?? p.openFiles.at(-1)?.path ?? null;
        editor.activeFilePath = activeFilePath;
        editor.viewerPanes =
          p.viewerPanes ?? (activeFilePath ? [{ id: 'primary', path: activeFilePath }] : []);
        editor.focusedViewerPaneId = p.focusedViewerPaneId ?? 'primary';
        if (p.viewerSplitDirection !== undefined) {
          editor.viewerSplitDirection = p.viewerSplitDirection;
        }
        if (p.viewerSplitRatio !== undefined) editor.viewerSplitRatio = p.viewerSplitRatio;
      } else if (p.openFilePath !== undefined) {
        if (p.openFilePath === null) {
          editor.openFilePaths = [];
          editor.openFilesByPath = {};
          editor.activeFilePath = null;
          editor.viewerPanes = [];
        } else {
          const file = createOpenFileState(p.openFilePath, p.panelMode ?? 'file');
          file.fileText = p.openFileText ?? null;
          file.diff = p.openDiff ?? null;
          file.editing = p.editing ?? false;
          file.draft = p.draft ?? null;
          file.saveError = p.saveError ?? null;
          editor.openFilePaths = [p.openFilePath];
          editor.openFilesByPath = { [p.openFilePath]: file };
          editor.activeFilePath = p.openFilePath;
          editor.viewerPanes = [{ id: 'primary', path: p.openFilePath }];
          editor.focusedViewerPaneId = 'primary';
        }
      }
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

  // Persist the tab layout to disk (debounced) so a full restart can offer to
  // restore it. We watch only the structural slices — adding/closing/splitting
  // tabs and switching the active one — not every status tick. While a restore
  // offer is still pending (cold start, user hasn't decided) we skip writing so
  // the empty initial state can't clobber the saved session before they choose.
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  const flushSave = async (): Promise<void> => {
    saveTimer = null;
    const s = useStore.getState();
    if (s.pendingRestore) return;
    // Pin each agent pane's session id *now*, while that pane is the live
    // session, so restore resumes the exact conversation instead of re-deriving
    // "newest for the cwd" later (a reload could race it). Primary source: the
    // kind-tagged id each pane's session-start hook reported (keyed by pty id —
    // exact even when two panes share a cwd). Fallback for claude panes with no
    // reported id (hook not installed / session predates it): newest transcript
    // for the cwd — Claude-only until other agents grow session stores.
    // Best-effort: a failed look-up just omits the pin and restore falls back
    // to a fresh resolve.
    const rawByPane = await window.treeline.agentSession.idsByPane().catch(() => ({}));
    const sessionIdByPane = new Map(Object.entries(rawByPane));
    const pinnedClaudePtys = new Set(
      [...sessionIdByPane].filter(([, v]) => v.kind === 'claude').map(([k]) => k),
    );
    const cwds = agentPaneCwds(s.tabs, 'claude', pinnedClaudePtys);
    const sessionIdByCwd = new Map<string, string>();
    await Promise.all(
      cwds.map(async (cwd) => {
        const id = await window.treeline.agentSession.latestForCwd(cwd, 'claude').catch(() => null);
        if (id) sessionIdByCwd.set(cwd, id);
      }),
    );
    // Re-check after the awaits — a restore may have been staged meanwhile.
    if (useStore.getState().pendingRestore) return;
    // Flag scratch tabs (keyed by PTY id) so restore can re-seed the memory-only
    // scratch slice — its sidebar row, cleanup wiring, and label numbering.
    const scratchPtyIds = new Set(s.scratches.map((sc) => sc.ptyId));
    void window.treeline.session.set(
      toPersistedSession(s.tabs, s.activeTabId, sessionIdByCwd, scratchPtyIds, sessionIdByPane),
    );
  };
  unsubs.push(
    useStore.subscribe((state, prev) => {
      if (state.tabs === prev.tabs && state.activeTabId === prev.activeTabId) return;
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => void flushSave(), 750);
    }),
  );
  unsubs.push(() => {
    if (saveTimer) clearTimeout(saveTimer);
  });

  // Persist the scratchpad buffer (debounced), independent of the session save
  // so note edits don't churn session.json. A blur in NotesPanel flushes
  // immediately; this covers mid-typing. `lastSavedScratch` avoids a redundant
  // write when loadInitialState seeds the buffer with what's already on disk.
  let scratchTimer: ReturnType<typeof setTimeout> | null = null;
  let lastSavedScratch = useStore.getState().scratchpadText;
  const flushScratch = (): void => {
    scratchTimer = null;
    const text = useStore.getState().scratchpadText;
    if (text === lastSavedScratch) return;
    lastSavedScratch = text;
    void window.treeline.scratchpad.set(text);
  };
  unsubs.push(
    useStore.subscribe((state, prev) => {
      if (state.scratchpadText === prev.scratchpadText) return;
      if (scratchTimer) clearTimeout(scratchTimer);
      scratchTimer = setTimeout(flushScratch, 750);
    }),
  );
  // Flush a pending scratchpad edit on window close so the last keystrokes
  // aren't lost during shutdown (the debounce may not have fired yet).
  const onBeforeUnload = () => {
    if (scratchTimer) {
      clearTimeout(scratchTimer);
      flushScratch();
    }
  };
  window.addEventListener('beforeunload', onBeforeUnload);
  unsubs.push(() => {
    if (scratchTimer) clearTimeout(scratchTimer);
    window.removeEventListener('beforeunload', onBeforeUnload);
  });

  return () => unsubs.forEach((fn) => fn());
}

/**
 * The directory a search is scoped to: the selected sidebar target (repo,
 * worktree, or folder) if any, else the focused terminal's cwd as a fallback so
 * ⌘P/⌘⇧F still do something useful when nothing is selected. Null when neither
 * is available.
 */
function resolveSearchRoot(): string | null {
  const s = useStore.getState();
  if (s.selectedSidebarPath) return s.selectedSidebarPath;
  const tab = s.tabs.find((t) => t.id === s.activeTabId);
  if (tab) {
    const leaf = findLeaf(tab.root, tab.focusedPaneId);
    if (leaf?.cwd) return leaf.cwd;
  }
  return null;
}

/**
 * Re-adopt PTYs that outlived a renderer reload. The renderer's tab state lives
 * in memory and is wiped on reload, but main's `PtyManager` keeps every shell
 * (and the agents inside them) running — without this they'd be orphaned,
 * killable only by quitting the app. We rebuild one tab per surviving PTY; the
 * re-mounted terminal nudges a resize so a TUI (e.g. an agent) repaints its
 * current frame (see useXterm). We deliberately don't replay captured output —
 * replaying a TUI's raw byte stream (alternate screen, partial frames) is
 * fragile and can wedge the terminal.
 *
 * A no-op on a fresh launch (no PTYs yet). Split layouts aren't restored — the
 * pane tree isn't persisted, so each surviving pane comes back as its own tab;
 * the point is that no shell is leaked. A scratch terminal is special-cased: its
 * sidebar row lives in the memory-only scratch slice (wiped on reload), so we
 * re-seed that row from the `scratchLabel` main echoes back for the surviving
 * PTY — otherwise the scratch degrades to a plain tab, and the next debounced
 * save would persist it *without* the scratch flag, losing the row for a later
 * cold restart too. Returns the number of live PTYs main was holding, so the
 * caller can tell a warm reload (≥1) from a cold start (0) — the cold start is
 * where the disk-backed session restore takes over.
 */
async function reattachPtys(): Promise<number> {
  const live = await window.treeline.pty.list().catch(() => []);
  if (live.length === 0) return 0;
  const s = useStore.getState();
  // Skip any PTY the store already tracks, so a re-entrant call can't dupe tabs.
  const known = new Set(s.tabs.flatMap((t) => leaves(t.root).map((l) => l.ptyId)));
  let adopted = 0;
  for (const { id, cwd, scratchLabel } of live) {
    if (known.has(id)) continue;
    // addTab reuses the pty id as the tab id; a scratch row keys on that same id
    // (scratch.id === ptyId === tab.id), so re-seeding here re-links the two.
    s.addTab({ ptyId: id, cwd, title: scratchLabel });
    if (scratchLabel !== undefined) {
      s.addScratch({ id, label: scratchLabel, ptyId: id, cwd, createdAt: Date.now() });
      registerScratchCleanup(id);
    }
    adopted++;
  }
  // Tell the user their sessions came back — the panes are blank for the beat
  // it takes each xterm to replay, so a silent restore reads as a hang.
  s.noteReattached(adopted);
  return live.length;
}

/** Hydrate initial state from disk + main: config, repos, worktrees. */
export async function loadInitialState(): Promise<void> {
  const api = window.treeline;
  const cfg = await api.config.get();
  useStore.getState().setRepos(cfg.repos);
  useStore.getState().setFolders(cfg.folders);
  useStore.getState().setSidebarCollapsed(cfg.sidebarCollapsed);
  useStore.getState().setSettings(cfg.settings);
  // Pins live in renderer storage rather than config.json. Validate them in
  // parallel without delaying the rest of startup; rows update as checks land.
  void refreshPinnedFilesAvailability();

  // Restore the persisted scratchpad buffer. Best-effort: a read failure just
  // leaves the buffer empty.
  const scratchpadText = await api.scratchpad.get().catch(() => '');
  if (scratchpadText) useStore.getState().setScratchpadText(scratchpadText);

  // Re-adopt shells that survived a reload before anything else paints, so a
  // reloaded window comes back with its terminals instead of leaking them.
  const liveCount = await reattachPtys();

  // Cold start (no surviving PTYs — an auto-update relaunch or a reboot): if a
  // non-empty tab layout was saved to disk, offer to restore it. The prompt
  // (RestorePrompt) drives the actual respawn; we only stage the offer here, and
  // the debounced save is suppressed while `pendingRestore` is set so the empty
  // launch state can't overwrite the saved session first.
  if (liveCount === 0) {
    const saved = await api.session.get().catch(() => null);
    if (saved && saved.tabs.length > 0) {
      useStore.getState().setPendingRestore(saved);
    }
  }

  // Seed PR status from the monitor's latest-known snapshot so a reload paints
  // badges immediately rather than waiting for the next poll. Best-effort.
  api.pr
    .snapshot()
    .then((prByRepoBranch) => useStore.getState().setAllPrInfo(prByRepoBranch))
    .catch(() => {
      /* gh unavailable / no data — badges just stay absent */
    });

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
