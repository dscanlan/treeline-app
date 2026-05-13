import { app, BrowserWindow, shell } from 'electron';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  defaultSpawn,
  PtyManager,
  type PtyCwdChangedEvent,
  type PtyExitEvent,
  type PtySpawnedEvent,
} from './pty-manager';
import { ReposStore } from './repos-store';
import { buildAppMenu } from './menu';
import { WorktreeWatcher } from './worktree-watcher';
import { TerminalStatusMonitor } from './terminal-status';
import { ProcessMonitor } from './process-monitor';
import { RepoDiscovery, type DiscoveredRepoEvent } from './repo-discovery';
import { broadcastDiscoveredRepo, registerReposIpc } from './ipc/repos';
import { registerWorktreesIpc, broadcastWorktreesChanged } from './ipc/worktrees';
import { registerPtyIpc } from './ipc/pty';
import { registerProcessesIpc, broadcastProcesses } from './ipc/processes';
import { registerConfigIpc } from './ipc/config';
import { broadcastTerminalStatus } from './ipc/terminal-status';
import { getScreenshotId, runScreenshot } from './screenshot';
import { setupAutoUpdater } from './updater';

let mainWindow: BrowserWindow | null = null;
let ptyManager: PtyManager | null = null;
let reposStore: ReposStore | null = null;
let worktreeWatcher: WorktreeWatcher | null = null;
let terminalStatusMonitor: TerminalStatusMonitor | null = null;
let processMonitor: ProcessMonitor | null = null;
let repoDiscovery: RepoDiscovery | null = null;
let isQuitting = false;

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'treeline',
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0e0f12', // Graphite surface — must match tailwind treeline-surface
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
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

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return win;
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
  registerConfigIpc(reposStore);

  buildAppMenu();
  mainWindow = createMainWindow();

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
