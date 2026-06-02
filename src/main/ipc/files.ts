import { ipcMain } from 'electron';
import { Channels } from '@shared/ipc-channels';
import { listDir, readFileGuarded } from '../files-io';
import { validateAbsPath } from '../util/safe-path';

/**
 * Read-only filesystem IPC for the code viewer. The actual fs work lives in
 * ../files-io.ts (unit-tested there); this layer just validates the
 * renderer-supplied path and forwards.
 */
export function registerFilesIpc(): () => void {
  ipcMain.handle(Channels.FilesReadDir, async (_e, rawPath: unknown) => {
    return listDir(validateAbsPath(rawPath));
  });

  ipcMain.handle(Channels.FilesRead, async (_e, rawPath: unknown) => {
    return readFileGuarded(validateAbsPath(rawPath));
  });

  return () => {
    ipcMain.removeHandler(Channels.FilesReadDir);
    ipcMain.removeHandler(Channels.FilesRead);
  };
}
