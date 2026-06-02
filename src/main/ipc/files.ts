import { ipcMain } from 'electron';
import { Channels } from '@shared/ipc-channels';
import { listDir, readFileGuarded, writeFileGuarded } from '../files-io';
import { changedFiles, fileDiff } from '../git';
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

  ipcMain.handle(Channels.FilesChanged, async (_e, rawPath: unknown) => {
    return changedFiles(validateAbsPath(rawPath));
  });

  ipcMain.handle(Channels.FilesDiff, async (_e, rawPath: unknown) => {
    return fileDiff(validateAbsPath(rawPath));
  });

  ipcMain.handle(Channels.FilesWrite, async (_e, rawPath: unknown, content: unknown) => {
    if (typeof content !== 'string') throw new Error('content must be a string');
    await writeFileGuarded(validateAbsPath(rawPath), content);
  });

  return () => {
    ipcMain.removeHandler(Channels.FilesReadDir);
    ipcMain.removeHandler(Channels.FilesRead);
    ipcMain.removeHandler(Channels.FilesChanged);
    ipcMain.removeHandler(Channels.FilesDiff);
    ipcMain.removeHandler(Channels.FilesWrite);
  };
}
