import { dialog, ipcMain, type BrowserWindow } from 'electron';
import { Channels } from '@shared/ipc-channels';
import type { Repo } from '@shared/types';
import { isGitRepo } from '../git';
import type { ReposStore } from '../repos-store';
import { validateAbsPath } from '../util/safe-path';

export interface ReposIpcHooks {
  onRepoAdded?: (path: string) => void;
  onRepoRemoved?: (path: string) => void;
}

export function registerReposIpc(
  store: ReposStore,
  getMainWindow: () => BrowserWindow | null,
  hooks: ReposIpcHooks = {},
): () => void {
  const handlers: Array<[string, (...args: unknown[]) => unknown]> = [];

  const handle = (channel: string, fn: (...args: unknown[]) => unknown) => {
    ipcMain.handle(channel, async (_e, ...args) => fn(...args));
    handlers.push([channel, fn]);
  };

  handle(Channels.ReposList, async (): Promise<Repo[]> => {
    return store.get().repos;
  });

  handle(Channels.ReposAdd, async (rawPath) => {
    const path = validateAbsPath(rawPath);
    const ok = await isGitRepo(path);
    if (!ok) throw new Error(`Not a git repository: ${path}`);
    const repo = await store.addRepo(path);
    hooks.onRepoAdded?.(path);
    return repo;
  });

  handle(Channels.ReposRemove, async (rawPath) => {
    const path = validateAbsPath(rawPath);
    await store.removeRepo(path);
    hooks.onRepoRemoved?.(path);
  });

  handle(Channels.ReposPickDirectory, async (): Promise<string | null> => {
    const win = getMainWindow();
    const opts: Electron.OpenDialogOptions = {
      title: 'Add repository',
      properties: ['openDirectory'],
      buttonLabel: 'Add',
    };
    const result = win
      ? await dialog.showOpenDialog(win, opts)
      : await dialog.showOpenDialog(opts);
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0] ?? null;
  });

  return () => {
    for (const [channel] of handlers) ipcMain.removeHandler(channel);
  };
}
