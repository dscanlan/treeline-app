import { ipcMain, webContents } from 'electron';
import { Channels } from '@shared/ipc-channels';
import {
  createWorktree,
  inspectWorktrees,
  listWorktreesIn,
  pruneWorktrees,
  repairWorktrees,
  removeWorktree,
} from '../git';
import type { Worktree } from '@shared/types';
import { validateAbsPath, validateBranchName } from '../util/safe-path';

export function registerWorktreesIpc(
  onListed: (repoPath: string, worktrees: Worktree[]) => void,
  onActiveRepos: (repoPaths: string[]) => void,
): () => void {
  ipcMain.handle(Channels.WorktreesList, async (_e, repoPath: unknown) => {
    const path = validateAbsPath(repoPath);
    const worktrees = await listWorktreesIn(path);
    onListed(path, worktrees);
    return worktrees;
  });

  // The renderer's view of which repos are in use. Only ever used as set keys
  // for the watcher's throttle, so a malformed entry is dropped, not fatal.
  ipcMain.on(Channels.WorktreesSetActiveRepos, (_e, repoPaths: unknown) => {
    if (!Array.isArray(repoPaths)) return;
    onActiveRepos(repoPaths.filter((p): p is string => typeof p === 'string'));
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

  ipcMain.handle(Channels.WorktreesRemove, async (_e, path: unknown, repoPath: unknown) => {
    await removeWorktree(validateAbsPath(path), validateAbsPath(repoPath));
  });

  ipcMain.handle(Channels.WorktreesInspect, async (_e, repoPath: unknown) => {
    return inspectWorktrees(validateAbsPath(repoPath));
  });
  ipcMain.handle(Channels.WorktreesRepair, async (_e, repoPath: unknown, movedPath: unknown) => {
    await repairWorktrees(
      validateAbsPath(repoPath),
      movedPath === undefined ? undefined : validateAbsPath(movedPath),
    );
  });
  ipcMain.handle(Channels.WorktreesPrune, async (_e, repoPath: unknown, preview: unknown) => {
    if (typeof preview !== 'string') throw new Error('Expected a worktree cleanup preview');
    await pruneWorktrees(validateAbsPath(repoPath), preview);
  });

  return () => {
    ipcMain.removeHandler(Channels.WorktreesList);
    ipcMain.removeHandler(Channels.WorktreesCreate);
    ipcMain.removeHandler(Channels.WorktreesRemove);
    ipcMain.removeHandler(Channels.WorktreesInspect);
    ipcMain.removeHandler(Channels.WorktreesRepair);
    ipcMain.removeHandler(Channels.WorktreesPrune);
    ipcMain.removeAllListeners(Channels.WorktreesSetActiveRepos);
  };
}

/** Broadcast a worktrees:onChange event to every renderer. */
export function broadcastWorktreesChanged(repoPath: string, worktrees: Worktree[]): void {
  for (const wc of webContents.getAllWebContents()) {
    if (wc.isDestroyed()) continue;
    wc.send(Channels.WorktreesOnChange, { repoPath, worktrees });
  }
}

/**
 * Broadcast a "terminal cwd drifted into a different worktree" event. Called
 * from main when `WorktreeDriftMonitor` notices a PTY move into another worktree.
 */
export function broadcastWorktreeDrift(payload: { ptyId: string; toWorktree: string }): void {
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
