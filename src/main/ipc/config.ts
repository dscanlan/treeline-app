import { ipcMain } from 'electron';
import { Channels } from '@shared/ipc-channels';
import type { ReposStore } from '../repos-store';

export function registerConfigIpc(store: ReposStore): () => void {
  ipcMain.handle(Channels.ConfigGet, async () => store.get());

  ipcMain.handle(Channels.ConfigSetCodeRoot, async (_e, p: unknown) => {
    if (p !== null && typeof p !== 'string') throw new Error('codeRoot must be string|null');
    await store.setCodeRoot(p);
  });

  ipcMain.handle(Channels.ConfigSetSidebarCollapsed, async (_e, v: unknown) => {
    if (typeof v !== 'boolean') throw new Error('sidebarCollapsed must be boolean');
    await store.setSidebarCollapsed(v);
  });

  return () => {
    ipcMain.removeHandler(Channels.ConfigGet);
    ipcMain.removeHandler(Channels.ConfigSetCodeRoot);
    ipcMain.removeHandler(Channels.ConfigSetSidebarCollapsed);
  };
}
