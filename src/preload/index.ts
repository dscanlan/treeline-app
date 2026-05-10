import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { Channels } from '@shared/ipc-channels';
import type { ScreenshotHydratePayload, TreelineApi } from '@shared/ipc-contract';
import type {
  AppConfig,
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
  },

  pty: {
    spawn: (opts) =>
      ipcRenderer.invoke(Channels.PtySpawn, opts) as Promise<{ id: string }>,
    write: (id, data) => ipcRenderer.send(Channels.PtyWrite, id, data),
    resize: (id, cols, rows) => ipcRenderer.send(Channels.PtyResize, id, cols, rows),
    kill: (id) => ipcRenderer.invoke(Channels.PtyKill, id) as Promise<void>,
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
  },

  processes: {
    snapshot: () =>
      ipcRenderer.invoke(Channels.ProcessesSnapshot) as Promise<ProcessSnapshot>,
    subscribe: (cb) => listen<ProcessSnapshot>(Channels.ProcessesUpdate, cb),
  },

  terminalStatus: {
    subscribe: (cb) => listen<TerminalStatusUpdate[]>(Channels.TerminalStatusUpdate, cb),
  },

  config: {
    get: () => ipcRenderer.invoke(Channels.ConfigGet) as Promise<AppConfig>,
    setCodeRoot: (p) =>
      ipcRenderer.invoke(Channels.ConfigSetCodeRoot, p) as Promise<void>,
    setSidebarCollapsed: (v) =>
      ipcRenderer.invoke(Channels.ConfigSetSidebarCollapsed, v) as Promise<void>,
  },

  window: {
    onSidebarToggle: (cb) => listen<void>(Channels.SidebarToggle, () => cb()),
  },

  // Snapshot of relevant system info. The value is baked into argv by main
  // (see additionalArguments in createMainWindow) so it's available
  // synchronously without an IPC round-trip.
  system: {
    homeDir: homeDirFromArgv(),
  },

  screenshot: {
    onHydrate: (cb) => listen<ScreenshotHydratePayload>(Channels.ScreenshotHydrate, cb),
    signalReady: () => ipcRenderer.send(Channels.ScreenshotReady),
  },
};

contextBridge.exposeInMainWorld('treeline', api);
