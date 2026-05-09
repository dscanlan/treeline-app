import { ipcMain, webContents } from 'electron';
import { Channels } from '@shared/ipc-channels';
import type {
  PtyDataEvent,
  PtyExitEvent,
  PtyManager,
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

  // Fan-out PtyManager events to every webContents. Renderer-side preload
  // pre-filters by id so each subscriber only fires for its tab.
  const onData = (e: PtyDataEvent) => broadcast(Channels.PtyData, e);
  const onExit = (e: PtyExitEvent) => broadcast(Channels.PtyExit, e);
  mgr.on('data', onData);
  mgr.on('exit', onExit);

  return () => {
    ipcMain.removeHandler(Channels.PtySpawn);
    ipcMain.removeAllListeners(Channels.PtyWrite);
    ipcMain.removeAllListeners(Channels.PtyResize);
    ipcMain.removeHandler(Channels.PtyKill);
    mgr.off('data', onData);
    mgr.off('exit', onExit);
  };
}

function broadcast(channel: string, payload: unknown): void {
  for (const wc of webContents.getAllWebContents()) {
    if (wc.isDestroyed()) continue;
    wc.send(channel, payload);
  }
}
