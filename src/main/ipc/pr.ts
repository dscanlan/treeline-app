import { ipcMain, webContents } from 'electron';
import { Channels } from '@shared/ipc-channels';
import type { PrInfo, PrSnapshot } from '@shared/types';

/**
 * Latest known PR map per repo, so a renderer that loads (or reloads) mid-poll
 * can fetch the current state via `pr:snapshot` without waiting for the next
 * tick. Mirrors the snapshot+broadcast pattern in `ipc/processes.ts`.
 */
let latest: Record<string, Record<string, PrInfo>> = {};

export function registerPrIpc(): () => void {
  ipcMain.handle(Channels.PrSnapshot, async () => latest);
  return () => ipcMain.removeHandler(Channels.PrSnapshot);
}

export function broadcastPr(snapshot: PrSnapshot): void {
  latest = { ...latest, [snapshot.repoPath]: snapshot.prByBranch };
  for (const wc of webContents.getAllWebContents()) {
    if (wc.isDestroyed()) continue;
    wc.send(Channels.PrUpdate, snapshot);
  }
}
