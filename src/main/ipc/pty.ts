import { ipcMain, webContents } from 'electron';
import { Channels } from '@shared/ipc-channels';
import type {
  PtyDataEvent,
  PtyExitEvent,
  PtyManager,
  PtyNotificationEvent,
  SpawnOpts,
} from '../pty-manager';
import { validateAbsPath } from '../util/safe-path';

export function registerPtyIpc(mgr: PtyManager): () => void {
  ipcMain.handle(Channels.PtySpawn, async (_e, raw: unknown) => {
    if (!raw || typeof raw !== 'object') throw new Error('invalid spawn opts');
    const o = raw as Partial<SpawnOpts>;
    const cwd = validateAbsPath(o.cwd);
    const cols = Number(o.cols) | 0 || 80;
    const rows = Number(o.rows) | 0 || 24;
    const shell = typeof o.shell === 'string' ? o.shell : undefined;
    const { id } = mgr.spawn({ cwd, cols, rows, shell });
    return { id };
  });

  // Live-PTY snapshot for reload re-attach. The renderer rebuilds a tab per
  // entry and replays each `buffer` so a reloaded window re-adopts the still
  // running shells instead of orphaning them.
  ipcMain.handle(Channels.PtyList, async () => mgr.list());

  ipcMain.on(Channels.PtyWrite, (_e, id: unknown, data: unknown) => {
    if (typeof id !== 'string' || typeof data !== 'string') return;
    mgr.write(id, data);
  });

  ipcMain.on(Channels.PtyResize, (_e, id: unknown, cols: unknown, rows: unknown) => {
    if (typeof id !== 'string') return;
    mgr.resize(id, Number(cols) | 0, Number(rows) | 0);
  });

  ipcMain.handle(Channels.PtyKill, async (_e, id: unknown) => {
    if (typeof id !== 'string') return;
    await mgr.kill(id);
  });

  ipcMain.handle(Channels.PtyPause, async (_e, id: unknown) => {
    if (typeof id !== 'string') return false;
    return mgr.pause(id);
  });

  ipcMain.handle(Channels.PtyResume, async (_e, id: unknown) => {
    if (typeof id !== 'string') return false;
    return mgr.resume(id);
  });

  // Fan-out PtyManager events to every webContents. Renderer-side preload
  // pre-filters by id so each subscriber only fires for its tab.
  const onData = (e: PtyDataEvent) => broadcast(Channels.PtyData, e);
  const onExit = (e: PtyExitEvent) => broadcast(Channels.PtyExit, e);
  const onNotification = (e: PtyNotificationEvent) =>
    broadcast(Channels.PtyNotification, e);
  mgr.on('data', onData);
  mgr.on('exit', onExit);
  mgr.on('notification', onNotification);

  return () => {
    ipcMain.removeHandler(Channels.PtySpawn);
    ipcMain.removeHandler(Channels.PtyList);
    ipcMain.removeAllListeners(Channels.PtyWrite);
    ipcMain.removeAllListeners(Channels.PtyResize);
    ipcMain.removeHandler(Channels.PtyKill);
    ipcMain.removeHandler(Channels.PtyPause);
    ipcMain.removeHandler(Channels.PtyResume);
    mgr.off('data', onData);
    mgr.off('exit', onExit);
    mgr.off('notification', onNotification);
  };
}

function broadcast(channel: string, payload: unknown): void {
  for (const wc of webContents.getAllWebContents()) {
    if (wc.isDestroyed()) continue;
    wc.send(channel, payload);
  }
}
