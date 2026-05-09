import { ipcMain, webContents } from 'electron';
import { Channels } from '@shared/ipc-channels';
import type { ProcessSnapshot } from '@shared/types';

let latestSnapshot: ProcessSnapshot = { procs: [], byWorktreePath: {} };

export function registerProcessesIpc(): () => void {
  ipcMain.handle(Channels.ProcessesSnapshot, async () => latestSnapshot);
  return () => ipcMain.removeHandler(Channels.ProcessesSnapshot);
}

export function broadcastProcesses(snap: ProcessSnapshot): void {
  latestSnapshot = snap;
  for (const wc of webContents.getAllWebContents()) {
    if (wc.isDestroyed()) continue;
    wc.send(Channels.ProcessesUpdate, snap);
  }
}
