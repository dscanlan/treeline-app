import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { Channels } from '@shared/ipc-channels';
import type { ScreenshotHydratePayload, TreelineApi } from '@shared/ipc-contract';
import type { CliRendererCommand } from '@shared/cli-protocol';
import type {
  AddPathResult,
  AppConfig,
  ChangedFile,
  DirEntry,
  FileContents,
  FileDiff,
  PrInfo,
  PrSnapshot,
  ProcessSnapshot,
  Repo,
  TerminalStatusUpdate,
  Worktree,
} from '@shared/types';

/**
 * Sandboxed preload (see `sandbox: true` in main/index.ts) can't import
 * Node built-ins like `node:os`. Main passes homedir via `additionalArguments`
 * on webPreferences, which appears in our `process.argv` here. Empty-string
 * fallback rather than throwing: nothing in the renderer should crash if the
 * scratch flow is never exercised.
 */
function homeDirFromArgv(): string {
  const PREFIX = '--treeline-home-dir=';
  for (const a of process.argv) {
    if (a.startsWith(PREFIX)) return a.slice(PREFIX.length);
  }
  return '';
}

// Helper: subscribe to an IPC event, optionally filter by predicate.
function listen<T>(
  channel: string,
  cb: (payload: T) => void,
  filter?: (payload: T) => boolean,
): () => void {
  const handler = (_e: IpcRendererEvent, payload: T) => {
    if (filter && !filter(payload)) return;
    cb(payload);
  };
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const api: TreelineApi = {
  repos: {
    list: () => ipcRenderer.invoke(Channels.ReposList) as Promise<Repo[]>,
    add: (path) => ipcRenderer.invoke(Channels.ReposAdd, path) as Promise<Repo>,
    addPath: (path) =>
      ipcRenderer.invoke(Channels.ReposAddPath, path) as Promise<AddPathResult>,
    create: (opts) => ipcRenderer.invoke(Channels.ReposCreate, opts) as Promise<Repo>,
    remove: (path) => ipcRenderer.invoke(Channels.ReposRemove, path) as Promise<void>,
    pickDirectory: () =>
      ipcRenderer.invoke(Channels.ReposPickDirectory) as Promise<string | null>,
    dismissDiscovered: (path) =>
      ipcRenderer.invoke(Channels.ReposDismissDiscovered, path) as Promise<void>,
    onDiscovered: (cb) =>
      listen<{ repoPath: string; viaCwd: string }>(Channels.ReposDiscovered, cb),
  },

  worktrees: {
    list: (repoPath) =>
      ipcRenderer.invoke(Channels.WorktreesList, repoPath) as Promise<Worktree[]>,
    create: (repoPath, branch, path) =>
      ipcRenderer.invoke(
        Channels.WorktreesCreate,
        repoPath,
        branch,
        path,
      ) as Promise<void>,
    remove: (path) =>
      ipcRenderer.invoke(Channels.WorktreesRemove, path) as Promise<void>,
    onChange: (cb) => listen<string>(Channels.WorktreesOnChange, cb),
    onDrift: (cb) =>
      listen<{ ptyId: string; toWorktree: string }>(Channels.WorktreesDrift, cb),
    onCreated: (cb) => listen<string>(Channels.WorktreesCreated, cb),
  },

  pty: {
    spawn: (opts) =>
      ipcRenderer.invoke(Channels.PtySpawn, opts) as Promise<{ id: string }>,
    write: (id, data) => ipcRenderer.send(Channels.PtyWrite, id, data),
    resize: (id, cols, rows) => ipcRenderer.send(Channels.PtyResize, id, cols, rows),
    kill: (id) => ipcRenderer.invoke(Channels.PtyKill, id) as Promise<void>,
    pause: (id) => ipcRenderer.invoke(Channels.PtyPause, id) as Promise<boolean>,
    resume: (id) => ipcRenderer.invoke(Channels.PtyResume, id) as Promise<boolean>,
    onData: (id, cb) =>
      listen<{ id: string; chunk: string }>(
        Channels.PtyData,
        (p) => cb(p.chunk),
        (p) => p.id === id,
      ),
    onExit: (id, cb) =>
      listen<{ id: string; code: number; signal: number | null }>(
        Channels.PtyExit,
        (p) => cb({ code: p.code, signal: p.signal }),
        (p) => p.id === id,
      ),
    // Unfiltered: a single store-level subscriber routes each event to the
    // right tab by its pty id (unlike onData/onExit, which are per-tab).
    onNotification: (cb) =>
      listen<{ id: string; text: string }>(Channels.PtyNotification, cb),
  },

  processes: {
    snapshot: () =>
      ipcRenderer.invoke(Channels.ProcessesSnapshot) as Promise<ProcessSnapshot>,
    subscribe: (cb) => listen<ProcessSnapshot>(Channels.ProcessesUpdate, cb),
  },

  pr: {
    snapshot: () =>
      ipcRenderer.invoke(Channels.PrSnapshot) as Promise<
        Record<string, Record<string, PrInfo>>
      >,
    subscribe: (cb) => listen<PrSnapshot>(Channels.PrUpdate, cb),
  },

  terminalStatus: {
    subscribe: (cb) => listen<TerminalStatusUpdate[]>(Channels.TerminalStatusUpdate, cb),
  },

  files: {
    readDir: (path) =>
      ipcRenderer.invoke(Channels.FilesReadDir, path) as Promise<DirEntry[]>,
    read: (path) => ipcRenderer.invoke(Channels.FilesRead, path) as Promise<FileContents>,
    changed: (path) =>
      ipcRenderer.invoke(Channels.FilesChanged, path) as Promise<ChangedFile[]>,
    diff: (path) => ipcRenderer.invoke(Channels.FilesDiff, path) as Promise<FileDiff>,
    write: (path, content) =>
      ipcRenderer.invoke(Channels.FilesWrite, path, content) as Promise<void>,
  },

  folders: {
    remove: (path) =>
      ipcRenderer.invoke(Channels.FoldersRemove, path) as Promise<void>,
  },

  claudeSession: {
    prepareResume: (worktreePath) =>
      ipcRenderer.invoke(Channels.ClaudeSessionPrepareResume, worktreePath) as Promise<
        { sessionId: string; originCwd: string } | null
      >,
  },

  config: {
    get: () => ipcRenderer.invoke(Channels.ConfigGet) as Promise<AppConfig>,
    setCodeRoot: (p) =>
      ipcRenderer.invoke(Channels.ConfigSetCodeRoot, p) as Promise<void>,
    setSidebarCollapsed: (v) =>
      ipcRenderer.invoke(Channels.ConfigSetSidebarCollapsed, v) as Promise<void>,
    setSettings: (settings) =>
      ipcRenderer.invoke(Channels.ConfigSetSettings, settings) as Promise<void>,
  },

  window: {
    onSidebarToggle: (cb) => listen<void>(Channels.SidebarToggle, () => cb()),
    onBrowserToggle: (cb) => listen<void>(Channels.BrowserToggle, () => cb()),
    onOpenSettings: (cb) => listen<void>(Channels.SettingsOpen, () => cb()),
    onJumpToUnread: (cb) => listen<void>(Channels.JumpToUnread, () => cb()),
  },

  cli: {
    onCommand: (cb) => listen<CliRendererCommand>(Channels.CliCommand, cb),
  },

  // Snapshot of relevant system info. The value is baked into argv by main
  // (see additionalArguments in createMainWindow) so it's available
  // synchronously without an IPC round-trip.
  system: {
    homeDir: homeDirFromArgv(),
    openExternal: (url) =>
      ipcRenderer.invoke(Channels.SystemOpenExternal, url) as Promise<void>,
  },

  screenshot: {
    onHydrate: (cb) => listen<ScreenshotHydratePayload>(Channels.ScreenshotHydrate, cb),
    signalReady: () => ipcRenderer.send(Channels.ScreenshotReady),
  },
};

contextBridge.exposeInMainWorld('treeline', api);
