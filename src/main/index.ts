import { app, BrowserWindow, shell } from 'electron';
import { join } from 'node:path';
import { defaultSpawn, PtyManager, type PtyExitEvent, type PtySpawnedEvent } from './pty-manager';
import { ReposStore } from './repos-store';
import { buildAppMenu } from './menu';
import { WorktreeWatcher } from './worktree-watcher';
import { TerminalStatusMonitor } from './terminal-status';
import { ProcessMonitor } from './process-monitor';
import { registerReposIpc } from './ipc/repos';
import { registerWorktreesIpc, broadcastWorktreesChanged } from './ipc/worktrees';
import { registerPtyIpc } from './ipc/pty';
import { registerProcessesIpc, broadcastProcesses } from './ipc/processes';
import { registerConfigIpc } from './ipc/config';
import { broadcastTerminalStatus } from './ipc/terminal-status';

let mainWindow: BrowserWindow | null = null;
let ptyManager: PtyManager | null = null;
let reposStore: ReposStore | null = null;
let worktreeWatcher: WorktreeWatcher | null = null;
let terminalStatusMonitor: TerminalStatusMonitor | null = null;
let processMonitor: ProcessMonitor | null = null;
let isQuitting = false;

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'treeline',
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#242742',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
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

  // Register all IPC handlers before the window loads, so the renderer never
  // sees a missing handler on first paint.
  registerReposIpc(reposStore, () => mainWindow, {
    onRepoAdded: (path) => worktreeWatcher?.add(path),
    onRepoRemoved: (path) => worktreeWatcher?.remove(path),
  });
  registerWorktreesIpc();
  registerPtyIpc(ptyManager);
  registerProcessesIpc();
  registerConfigIpc(reposStore);

  buildAppMenu();
  mainWindow = createMainWindow();

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
