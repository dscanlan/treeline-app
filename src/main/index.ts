import { app, BrowserWindow, Notification, shell } from 'electron';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Channels } from '@shared/ipc-channels';
import type { CliRendererCommand } from '@shared/cli-protocol';
import {
  defaultSpawn,
  PtyManager,
  setManagedBinDir,
  type PtyCwdChangedEvent,
  type PtyExitEvent,
  type PtyNotificationEvent,
  type PtySpawnedEvent,
} from './pty-manager';
import { materializeCliShim } from './cli-install';
import { resolveNotificationTargets } from './notification-targets';
import { ReposStore } from './repos-store';
import { SessionStore } from './session-store';
import { ScratchpadStore } from './scratchpad-store';
import { buildAppMenu } from './menu';
import { resolveKeybindings } from '@shared/keybindings';
import { appPaletteForId } from '@shared/terminal-theme';
import { WorktreeWatcher } from './worktree-watcher';
import { TerminalStatusMonitor } from './terminal-status';
import { ProcessMonitor } from './process-monitor';
import { PrMonitor } from './pr-monitor';
import { RepoDiscovery, type DiscoveredRepoEvent } from './repo-discovery';
import {
  WorktreeDriftMonitor,
  type WorktreeDriftEvent,
} from './worktree-drift-monitor';
import { broadcastDiscoveredRepo, registerReposIpc } from './ipc/repos';
import {
  registerWorktreesIpc,
  broadcastWorktreesChanged,
  broadcastWorktreeDrift,
  broadcastWorktreeCreated,
} from './ipc/worktrees';
import { registerPtyIpc } from './ipc/pty';
import { registerProcessesIpc, broadcastProcesses } from './ipc/processes';
import { registerPrIpc, broadcastPr } from './ipc/pr';
import { registerSystemIpc } from './ipc/system';
import { registerConfigIpc } from './ipc/config';
import { registerSessionIpc } from './ipc/session';
import { registerScratchpadIpc } from './ipc/scratchpad';
import { registerFilesIpc } from './ipc/files';
import { registerClaudeSessionIpc } from './ipc/claude-session';
import { broadcastTerminalStatus } from './ipc/terminal-status';
import { getScreenshotId, runScreenshot } from './screenshot';
import { setupAutoUpdater } from './updater';
import { isSafeExternalUrl } from './util/safe-url';
import { listWorktreesIn } from './git';
import { CliServer } from './cli-server';
import { buildCliHandlers } from './cli-handlers';
import { cliSocketPath } from './cli-socket-path';
import {
  setBrowserGuest,
  clearBrowserGuest,
  evalInBrowser,
  captureBrowser,
  captureBrowserToFile,
  waitForGuestLoad,
  snapshotBrowser,
  queryBrowserElement,
  clickInBrowser,
  fillInBrowser,
} from './browser-guest';

let mainWindow: BrowserWindow | null = null;
let ptyManager: PtyManager | null = null;
let reposStore: ReposStore | null = null;
let sessionStore: SessionStore | null = null;
let scratchpadStore: ScratchpadStore | null = null;
let worktreeWatcher: WorktreeWatcher | null = null;
let terminalStatusMonitor: TerminalStatusMonitor | null = null;
let processMonitor: ProcessMonitor | null = null;
let prMonitor: PrMonitor | null = null;
let repoDiscovery: RepoDiscovery | null = null;
let worktreeDrift: WorktreeDriftMonitor | null = null;
let cliServer: CliServer | null = null;
let isQuitting = false;

/** Bring the app's window to the foreground (used by CLI `notify`/`open`). */
function focusMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

/** Forward a resolved CLI command to the renderer (see ipc/client.ts). */
function sendCliCommand(cmd: CliRendererCommand): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(Channels.CliCommand, cmd);
  }
}

function createMainWindow(backgroundColor = '#0e0f12'): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'treeline',
    titleBarStyle: 'hiddenInset',
    // Themed surface so cold start doesn't flash the default before React
    // paints; defaults to Graphite surface (matches tailwind treeline-surface).
    backgroundColor,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Enables the <webview> tag used by the embedded browser pane
      // (BrowserPane). Guests are hardened in `hardenWebviews()` below — own
      // partition, no node integration, external links routed to the OS.
      webviewTag: true,
      // Sandboxed preload can't import `node:os`, but it CAN read
      // `process.argv`. Bake homedir into the preload's argv at window
      // creation; the preload parses it and exposes it as
      // `window.treeline.system.homeDir`. Used by the scratch-terminal flow.
      additionalArguments: [`--treeline-home-dir=${homedir()}`],
    },
  });

  win.once('ready-to-show', () => win.show());
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });

  // Links clicked in the renderer (notably xterm's WebLinksAddon, which turns
  // arbitrary terminal output into clickable links) arrive here. Terminal
  // content is attacker-influenceable — a malicious file printed to the
  // terminal, or AI-tool output — so only hand off web/mail schemes to the OS.
  // Anything else (file://, smb://, custom handlers, …) is dropped: those can
  // launch local handlers or exfiltrate via SMB without a further prompt.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  hardenWebviews(win);

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return win;
}

/**
 * Lock down the <webview> guests hosted by the embedded browser pane. Unlike
 * the read-only code viewer (`files.*`, explicitly *not* a trust boundary),
 * this is a real network-capable browser, so it widens the app's trust
 * surface — keep the guest stripped of any privileged config:
 *
 * - `will-attach-webview`: no preload, no node integration, isolation on —
 *   the page is plain web content with no bridge into the app.
 * - guest `setWindowOpenHandler`: `window.open` / target=_blank don't spawn
 *   uncontrolled child windows; safe web/mail links go to the OS browser
 *   (same posture as the main window), everything else is dropped.
 */
function hardenWebviews(win: BrowserWindow): void {
  win.webContents.on('will-attach-webview', (_e, webPreferences) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
  });
  win.webContents.on('did-attach-webview', (_e, guest) => {
    // Hand main a handle to the guest so the scriptable CLI (`treeline browser
    // eval/screenshot`) can drive it. Cleared when the pane is closed/reloaded
    // and the guest is torn down. This is the ONLY place the guest is captured.
    setBrowserGuest(guest);
    guest.once('destroyed', () => clearBrowserGuest(guest));
    guest.setWindowOpenHandler(({ url }) => {
      if (isSafeExternalUrl(url)) void shell.openExternal(url);
      return { action: 'deny' };
    });
  });
}

app.whenReady().then(() => {
  // Dev mode shows Electron's default Dock icon because the .icns is only
  // embedded in the .app bundle at packaging time. Override at runtime so
  // `npm run dev` shows the project icon. Guarded so prod is untouched.
  if (process.platform === 'darwin' && !app.isPackaged) {
    app.dock?.setIcon(join(__dirname, '../../resources/icon.png'));
  }

  reposStore = new ReposStore(join(app.getPath('userData'), 'config.json'));
  const cfg = reposStore.load();
  sessionStore = new SessionStore(join(app.getPath('userData'), 'session.json'));
  sessionStore.load();
  scratchpadStore = new ScratchpadStore(join(app.getPath('userData'), 'scratchpad.json'));
  scratchpadStore.load();

  // Make the `treeline` CLI reachable from agents in spawned terminals: write
  // the shim, then prepend its dir to every shell's PATH. Best-effort — a
  // failure here must not block the GUI, so the terminals just lack the shim.
  try {
    setManagedBinDir(materializeCliShim());
  } catch (err) {
    console.error('failed to materialize treeline CLI shim:', err);
  }

  ptyManager = new PtyManager(defaultSpawn);

  terminalStatusMonitor = new TerminalStatusMonitor();
  ptyManager.on('spawned', ({ id, shellPid }: PtySpawnedEvent) => {
    terminalStatusMonitor?.register(id, shellPid);
  });
  ptyManager.on('exit', ({ id }: PtyExitEvent) => {
    terminalStatusMonitor?.unregister(id);
    worktreeDrift?.release(id);
  });
  terminalStatusMonitor.on('updates', (updates) => broadcastTerminalStatus(updates));
  terminalStatusMonitor.start();

  processMonitor = new ProcessMonitor();
  processMonitor.on('snapshot', (snap) => broadcastProcesses(snap));
  processMonitor.start();

  // GitHub PR status per branch via the `gh` CLI. Polls slowly (network +
  // rate limits) and broadcasts deltas; no-ops if `gh` isn't installed.
  prMonitor = new PrMonitor();
  prMonitor.on('update', (snap) => broadcastPr(snap));
  prMonitor.setRepoPaths(cfg.repos.map((r) => r.path));
  void prMonitor.start();

  worktreeWatcher = new WorktreeWatcher();
  // Per-repo set of worktree paths we've already seen, so we can tell a
  // genuinely *new* worktree (created this session) from the ones present at
  // startup. The first `change` for a repo seeds it silently — so neither app
  // launch nor adding a repo prompts; only worktrees that appear afterward do.
  const knownWorktreesByRepo = new Map<string, Set<string>>();
  worktreeWatcher.on(
    'change',
    ({ repoPath, worktrees }: { repoPath: string; worktrees: { path: string }[] }) => {
      broadcastWorktreesChanged(repoPath);
      const wtPaths = worktreeWatcher?.allWorktreePaths() ?? [];
      processMonitor?.setWorktreePaths(wtPaths);
      // Keep cwd-drift detection's target set current so a just-created
      // worktree is recognised if a shell later `cd`s into it.
      worktreeDrift?.setWorktreePaths(wtPaths);

      // Surface newly-created worktrees as "open a terminal?" prompts. This is
      // the reliable trigger for the agent flow (`git worktree add`), where no
      // shell cwd ever actually changes.
      const repoPaths = worktrees.map((w) => w.path);
      const seen = knownWorktreesByRepo.get(repoPath);
      knownWorktreesByRepo.set(repoPath, new Set(repoPaths));
      if (seen) {
        for (const p of repoPaths) if (!seen.has(p)) broadcastWorktreeCreated(p);
      }

      // A new/removed worktree may add or retire a branch with a PR — refresh
      // this repo's PR map off the same debounced signal rather than per-render.
      void prMonitor?.refreshRepo(repoPath);
    },
  );
  for (const repo of cfg.repos) worktreeWatcher.add(repo.path);
  // Initial seed for the process monitor so prefix matching works on tick #1.
  processMonitor.setWorktreePaths(worktreeWatcher.allWorktreePaths());

  // Watches for cwds inside untracked git repos and surfaces them to the
  // renderer as toast prompts. Seeded with the current tracked + dismissed
  // sets; kept in sync via the repos IPC hooks below.
  repoDiscovery = new RepoDiscovery();
  repoDiscovery.setTrackedRepos(cfg.repos.map((r) => r.path));
  repoDiscovery.setDismissedRepos(cfg.dismissedRepos);
  ptyManager.on('cwd-changed', ({ id, cwd }: PtyCwdChangedEvent) => {
    void repoDiscovery?.onCwd(cwd);
    worktreeDrift?.onCwd(id, cwd);
  });

  // An agent inside a terminal raised an attention notification (OSC 9/99/777).
  // The in-app ring/badge is driven by registerPtyIpc broadcasting this same
  // event to the renderer; here we *also* raise a native OS toast, but only when
  // the window is in the background — when it's focused the in-app ring is enough
  // and a toast would just be noise. Clicking the toast focuses the app.
  ptyManager.on('notification', ({ text }: PtyNotificationEvent) => {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused()) return;
    if (!Notification.isSupported()) return;
    const n = new Notification({ title: 'treeline', body: text });
    n.on('click', () => focusMainWindow());
    n.show();
  });
  repoDiscovery.on('discovered-repo', (e: DiscoveredRepoEvent) => {
    broadcastDiscoveredRepo(e);
  });

  // Notices when a terminal's cwd moves into a *different* worktree than it
  // spawned in (the `git worktree add ../feat && cd ../feat` flow) and offers
  // to open a terminal there. Seeded with the same worktree set as the process
  // monitor; refreshed on every worktree change above.
  worktreeDrift = new WorktreeDriftMonitor();
  worktreeDrift.setWorktreePaths(worktreeWatcher.allWorktreePaths());
  worktreeDrift.on('worktree-drift', (e: WorktreeDriftEvent) => {
    broadcastWorktreeDrift({ ptyId: e.ptyId, toWorktree: e.toWorktree });
  });

  // Register all IPC handlers before the window loads, so the renderer never
  // sees a missing handler on first paint.
  registerReposIpc(reposStore, () => mainWindow, {
    onRepoAdded: (path) => {
      worktreeWatcher?.add(path);
      repoDiscovery?.setTrackedRepos(reposStore?.get().repos.map((r) => r.path) ?? []);
      prMonitor?.setRepoPaths(reposStore?.get().repos.map((r) => r.path) ?? []);
    },
    onRepoRemoved: (path) => {
      worktreeWatcher?.remove(path);
      repoDiscovery?.setTrackedRepos(reposStore?.get().repos.map((r) => r.path) ?? []);
      prMonitor?.setRepoPaths(reposStore?.get().repos.map((r) => r.path) ?? []);
    },
    onRepoDismissed: () => {
      repoDiscovery?.setDismissedRepos(reposStore?.get().dismissedRepos ?? []);
    },
  });
  registerWorktreesIpc();
  registerPtyIpc(ptyManager);
  registerProcessesIpc();
  registerPrIpc();
  registerSystemIpc();
  registerConfigIpc(reposStore, {
    // Rebuild the app menu when keybindings change so new accelerators apply
    // without a restart.
    onSettingsChanged: (settings) => {
      buildAppMenu(resolveKeybindings(settings.keybindings));
    },
  });
  registerFilesIpc();
  registerClaudeSessionIpc();
  registerSessionIpc(sessionStore);
  registerScratchpadIpc(scratchpadStore);

  // Scriptable CLI: listen on a user-scoped unix socket so the `treeline` CLI
  // (and agents/hooks) can drive the running app. Verbs route through the same
  // services the GUI uses, so behaviour can't drift. Failing to bind is
  // non-fatal — the GUI still works without the socket.
  cliServer = new CliServer(
    cliSocketPath(app.getPath('userData')),
    buildCliHandlers({
      version: app.getVersion(),
      listRepos: () => reposStore?.get().repos ?? [],
      listWorktrees: (repoPath) => listWorktreesIn(repoPath),
      notify: (text, cwd, paneId) => {
        // Tie the notification to the pane the agent ran in. The Claude Code hook
        // has no controlling tty to emit an OSC into, so it reports over the
        // socket. Re-emitting the same 'notification' event the OSC scanner raises
        // lights the in-app ring/badge (via registerPtyIpc) and the native toast
        // when unfocused (via the ptyManager 'notification' handler above).
        let matched = 0;
        const mgr = ptyManager;
        if (mgr) {
          const targets = resolveNotificationTargets(mgr, { cwd, paneId });
          for (const id of targets) {
            mgr.emit('notification', { id, text } satisfies PtyNotificationEvent);
            matched++;
          }
        }
        // Couldn't tie it to a pane (no cwd, or the agent isn't in a tracked
        // pane): fall back to a plain native toast so the signal isn't lost.
        // DON'T steal focus — a Stop hook fires on every response. Clicking the
        // toast focuses. (In `npm run dev` the unsigned Electron binary may be
        // denied by macOS with UNError 1 — toasts are reliable only when packaged.)
        if (matched === 0 && Notification.isSupported()) {
          const n = new Notification({ title: 'treeline', body: text });
          n.on('click', () => focusMainWindow());
          n.show();
        }
      },
      openWorktree: (cwd) => {
        focusMainWindow();
        sendCliCommand({ verb: 'open', cwd });
      },
      // No focus-steal: scripts/agents type into the active pane in the
      // background. The renderer no-ops if no terminal is focused.
      sendKeys: (text) => sendCliCommand({ verb: 'send', text }),
      // Open the browser pane through the renderer (opening it is React state);
      // eval/screenshot run against the guest webContents directly in main.
      browserNavigate: async (url, wait) => {
        focusMainWindow();
        sendCliCommand({ verb: 'browser-navigate', url });
        if (wait) await waitForGuestLoad(url);
      },
      browserEval: (code) => evalInBrowser(code),
      browserScreenshot: () => captureBrowser(),
      browserScreenshotToFile: (path) => captureBrowserToFile(path),
      browserSnapshot: () => snapshotBrowser(),
      browserQuery: (selector) => queryBrowserElement(selector),
      browserClick: (selector) => clickInBrowser(selector),
      browserFill: (selector, text) => fillInBrowser(selector, text),
    }),
  );
  cliServer.start().catch((err) => {
    console.error('failed to start CLI socket server:', err);
  });

  // Drive menu accelerators from the resolved keybinding map. Rebuilt below
  // whenever settings change so user rebindings take effect without a restart.
  buildAppMenu(resolveKeybindings(cfg.settings.keybindings));
  mainWindow = createMainWindow(appPaletteForId(cfg.settings.terminalTheme).surface);

  // Wire auto-updates after the window exists so update dialogs can attach
  // to it as their parent. No-op in dev (electron-updater only works against
  // a packaged + signed .app).
  setupAutoUpdater(() => mainWindow);

  // Headless screenshot mode. When TREELINE_SCREENSHOT_ID is set, the app
  // sets up the named scenario, captures the renderer to docs/img/, and
  // exits. See src/main/screenshot.ts and scripts/take-screenshots-auto.sh.
  const screenshotId = getScreenshotId();
  if (screenshotId && mainWindow) {
    void runScreenshot(mainWindow, screenshotId, ptyManager);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
    }
  });
});

app.on('before-quit', async (e) => {
  if (isQuitting) return;
  isQuitting = true;
  worktreeWatcher?.stop();
  terminalStatusMonitor?.stop();
  processMonitor?.stop();
  prMonitor?.stop();
  void cliServer?.stop();
  if (!ptyManager) return;
  // Best-effort: SIGHUP every PTY, then SIGKILL any holdouts after the grace.
  e.preventDefault();
  await ptyManager.killAll().catch(() => {
    /* ignore */
  });
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
