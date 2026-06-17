import { app, BrowserWindow, Notification, shell } from 'electron';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Channels } from '@shared/ipc-channels';
import type { CliRendererCommand } from '@shared/cli-protocol';
import {
  defaultSpawn,
  PtyManager,
  type PtyCwdChangedEvent,
  type PtyExitEvent,
  type PtySpawnedEvent,
} from './pty-manager';
import { ReposStore } from './repos-store';
import { buildAppMenu } from './menu';
import { resolveKeybindings } from '@shared/keybindings';
import { appPaletteForId } from '@shared/terminal-theme';
import { WorktreeWatcher } from './worktree-watcher';
import { TerminalStatusMonitor } from './terminal-status';
import { ProcessMonitor } from './process-monitor';
import { RepoDiscovery, type DiscoveredRepoEvent } from './repo-discovery';
import { broadcastDiscoveredRepo, registerReposIpc } from './ipc/repos';
import { registerWorktreesIpc, broadcastWorktreesChanged } from './ipc/worktrees';
import { registerPtyIpc } from './ipc/pty';
import { registerProcessesIpc, broadcastProcesses } from './ipc/processes';
import { registerConfigIpc } from './ipc/config';
import { registerFilesIpc } from './ipc/files';
import { broadcastTerminalStatus } from './ipc/terminal-status';
import { getScreenshotId, runScreenshot } from './screenshot';
import { setupAutoUpdater } from './updater';
import { isSafeExternalUrl } from './util/safe-url';
import { listWorktreesIn } from './git';
import { CliServer } from './cli-server';
import { buildCliHandlers } from './cli-handlers';
import { cliSocketPath } from './cli-socket-path';

let mainWindow: BrowserWindow | null = null;
let ptyManager: PtyManager | null = null;
let reposStore: ReposStore | null = null;
let worktreeWatcher: WorktreeWatcher | null = null;
let terminalStatusMonitor: TerminalStatusMonitor | null = null;
let processMonitor: ProcessMonitor | null = null;
let repoDiscovery: RepoDiscovery | null = null;
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

  ptyManager = new PtyManager(defaultSpawn);

  terminalStatusMonitor = new TerminalStatusMonitor();
  ptyManager.on('spawned', ({ id, shellPid }: PtySpawnedEvent) => {
    terminalStatusMonitor?.register(id, shellPid);
  });
  ptyManager.on('exit', ({ id }: PtyExitEvent) => {
    terminalStatusMonitor?.unregister(id);
  });
  terminalStatusMonitor.on('updates', (updates) => broadcastTerminalStatus(updates));
  terminalStatusMonitor.start();

  processMonitor = new ProcessMonitor();
  processMonitor.on('snapshot', (snap) => broadcastProcesses(snap));
  processMonitor.start();

  worktreeWatcher = new WorktreeWatcher();
  worktreeWatcher.on('change', ({ repoPath }: { repoPath: string }) => {
    broadcastWorktreesChanged(repoPath);
    processMonitor?.setWorktreePaths(worktreeWatcher?.allWorktreePaths() ?? []);
  });
  for (const repo of cfg.repos) worktreeWatcher.add(repo.path);
  // Initial seed for the process monitor so prefix matching works on tick #1.
  processMonitor.setWorktreePaths(worktreeWatcher.allWorktreePaths());

  // Watches for cwds inside untracked git repos and surfaces them to the
  // renderer as toast prompts. Seeded with the current tracked + dismissed
  // sets; kept in sync via the repos IPC hooks below.
  repoDiscovery = new RepoDiscovery();
  repoDiscovery.setTrackedRepos(cfg.repos.map((r) => r.path));
  repoDiscovery.setDismissedRepos(cfg.dismissedRepos);
  ptyManager.on('cwd-changed', ({ cwd }: PtyCwdChangedEvent) => {
    void repoDiscovery?.onCwd(cwd);
  });
  repoDiscovery.on('discovered-repo', (e: DiscoveredRepoEvent) => {
    broadcastDiscoveredRepo(e);
  });

  // Register all IPC handlers before the window loads, so the renderer never
  // sees a missing handler on first paint.
  registerReposIpc(reposStore, () => mainWindow, {
    onRepoAdded: (path) => {
      worktreeWatcher?.add(path);
      repoDiscovery?.setTrackedRepos(reposStore?.get().repos.map((r) => r.path) ?? []);
    },
    onRepoRemoved: (path) => {
      worktreeWatcher?.remove(path);
      repoDiscovery?.setTrackedRepos(reposStore?.get().repos.map((r) => r.path) ?? []);
    },
    onRepoDismissed: () => {
      repoDiscovery?.setDismissedRepos(reposStore?.get().dismissedRepos ?? []);
    },
  });
  registerWorktreesIpc();
  registerPtyIpc(ptyManager);
  registerProcessesIpc();
  registerConfigIpc(reposStore, {
    // Rebuild the app menu when keybindings change so new accelerators apply
    // without a restart.
    onSettingsChanged: (settings) => {
      buildAppMenu(resolveKeybindings(settings.keybindings));
    },
  });
  registerFilesIpc();

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
      notify: (text) => {
        // Show a native notification but DON'T steal focus — a Claude Code Stop
        // hook fires `notify` on every response, so force-focusing would yank
        // the user's window away constantly. Clicking the notification focuses.
        // (In `npm run dev` the unsigned Electron binary may be denied by macOS
        // with UNError 1 — notifications are reliable only in a packaged build.)
        if (Notification.isSupported()) {
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
