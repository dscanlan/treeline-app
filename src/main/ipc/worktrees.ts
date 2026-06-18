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

/**
 * Broadcast a "terminal cwd drifted into a different worktree" event. Called
 * from main when `WorktreeDriftMonitor` notices a PTY move into another worktree.
 */
export function broadcastWorktreeDrift(payload: {
  ptyId: string;
  toWorktree: string;
}): void {
  for (const wc of webContents.getAllWebContents()) {
    if (wc.isDestroyed()) continue;
    wc.send(Channels.WorktreesDrift, payload);
  }
}

/**
 * Broadcast a "new worktree created" event (a worktree path that appeared this
 * session). Called from main when `WorktreeWatcher` reports an added worktree.
 */
export function broadcastWorktreeCreated(path: string): void {
  for (const wc of webContents.getAllWebContents()) {
    if (wc.isDestroyed()) continue;
    wc.send(Channels.WorktreesCreated, path);
  }
}
