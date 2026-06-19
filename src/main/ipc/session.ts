import { ipcMain } from 'electron';
import { Channels } from '@shared/ipc-channels';
import type { SessionStore } from '../session-store';

/**
 * IPC for the persisted tab layout (`session.json`). The renderer owns tab
 * state; it reads the saved session once on launch (`get`) to offer a restore
 * after a full restart, and pushes a debounced snapshot (`set`) as tabs change.
 * The store coerces every `set` payload defensively — it's renderer-originated.
 */
export function registerSessionIpc(store: SessionStore): () => void {
  ipcMain.handle(Channels.SessionGet, async () => store.get());
  ipcMain.handle(Channels.SessionSet, async (_e, payload: unknown) => {
    await store.set(payload);
  });

  return () => {
    ipcMain.removeHandler(Channels.SessionGet);
    ipcMain.removeHandler(Channels.SessionSet);
  };
}
