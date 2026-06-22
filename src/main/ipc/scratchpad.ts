import { ipcMain } from 'electron';
import { Channels } from '@shared/ipc-channels';
import type { ScratchpadStore } from '../scratchpad-store';

/**
 * IPC for the persistent scratchpad buffer (`scratchpad.json`). The renderer
 * owns the text; it reads it once on launch (`get`) and pushes the current text
 * (`set`) as it changes — debounced, on blur, and on window close. The store
 * coerces + caps every `set` payload defensively (it's renderer-originated).
 */
export function registerScratchpadIpc(store: ScratchpadStore): () => void {
  ipcMain.handle(Channels.ScratchpadGet, async () => store.getText());
  ipcMain.handle(Channels.ScratchpadSet, async (_e, payload: unknown) => {
    await store.setText(payload);
  });

  return () => {
    ipcMain.removeHandler(Channels.ScratchpadGet);
    ipcMain.removeHandler(Channels.ScratchpadSet);
  };
}
