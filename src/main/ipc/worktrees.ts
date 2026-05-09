import { ipcMain, webContents } from 'electron';
import { Channels } from '@shared/ipc-channels';
import { createWorktree, listWorktreesIn, removeWorktree } from '../git';
import { validateAbsPath, validateBranchName } from '../util/safe-path';

export function registerWorktreesIpc(): () => void {
  ipcMain.handle(Channels.WorktreesList, async (_e, repoPath: unknown) => {
    return listWorktreesIn(validateAbsPath(repoPath));
  });

  ipcMain.handle(
    Channels.WorktreesCreate,
    async (_e, repoPath: unknown, branch: unknown, path: unknown) => {
      await createWorktree(
        validateAbsPath(repoPath),
        validateAbsPath(path),
        validateBranchName(branch),
      );
    },
  );

  ipcMain.handle(Channels.WorktreesRemove, async (_e, path: unknown) => {
    await removeWorktree(validateAbsPath(path));
  });

  return () => {
    ipcMain.removeHandler(Channels.WorktreesList);
    ipcMain.removeHandler(Channels.WorktreesCreate);
    ipcMain.removeHandler(Channels.WorktreesRemove);
  };
}

/** Broadcast a worktrees:onChange event to every renderer. */
export function broadcastWorktreesChanged(repoPath: string): void {
  for (const wc of webContents.getAllWebContents()) {
    if (wc.isDestroyed()) continue;
    wc.send(Channels.WorktreesOnChange, repoPath);
  }
}
