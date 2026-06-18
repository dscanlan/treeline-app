import { BrowserWindow, dialog, ipcMain } from 'electron';
import { Channels } from '@shared/ipc-channels';
import type { AddPathResult, Repo } from '@shared/types';
import { resolveParentRepoPath } from '../git';
import { createRepo, type CreateRepoOpts } from '../repos-create';
import type { ReposStore } from '../repos-store';
import { validateAbsPath } from '../util/safe-path';

export interface ReposIpcHooks {
  onRepoAdded?: (path: string) => void;
  onRepoRemoved?: (path: string) => void;
  /** Called after dismissedRepos has been persisted. */
  onRepoDismissed?: (path: string) => void;
}

/**
 * Broadcast a discovered-repo event to every renderer. Called from the main
 * process when `RepoDiscovery` notices an untracked repo via a PTY cwd.
 */
export function broadcastDiscoveredRepo(payload: {
  repoPath: string;
  viaCwd: string;
}): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(Channels.ReposDiscovered, payload);
  }
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
    // Resolve to the parent repo's working tree so picking a worktree path
    // (e.g. `<repo>/.claude/worktrees/foo`), a subdirectory, or the repo root
    // all converge on the same canonical entry. This is what makes the
    // toast's Add and the sidebar's "+ Add repo" both accept worktree paths.
    const parent = await resolveParentRepoPath(path);
    if (!parent) throw new Error(`Not a git repository: ${path}`);
    const repo = await store.addRepo(parent);
    hooks.onRepoAdded?.(parent);
    return repo;
  });

  handle(Channels.ReposAddPath, async (rawPath): Promise<AddPathResult> => {
    const path = validateAbsPath(rawPath);
    // Classify the picked directory: a git repo (or any path inside one) is
    // added as a repo with worktrees, exactly like ReposAdd. Anything else is
    // pinned as a plain folder root — a bare, git-free file tree.
    const parent = await resolveParentRepoPath(path);
    if (parent) {
      const repo = await store.addRepo(parent);
      hooks.onRepoAdded?.(parent);
      return { kind: 'repo', repo };
    }
    const folder = await store.addFolder(path);
    return { kind: 'folder', folder };
  });

  handle(Channels.FoldersRemove, async (rawPath) => {
    const path = validateAbsPath(rawPath);
    await store.removeFolder(path);
  });

  handle(Channels.ReposCreate, async (rawOpts) => {
    // createRepo validates rawOpts internally; we just narrow the unknown.
    const repo = await createRepo(store, rawOpts as CreateRepoOpts);
    hooks.onRepoAdded?.(repo.path);
    return repo;
  });

  handle(Channels.ReposRemove, async (rawPath) => {
    const path = validateAbsPath(rawPath);
    await store.removeRepo(path);
    hooks.onRepoRemoved?.(path);
  });

  handle(Channels.ReposDismissDiscovered, async (rawPath) => {
    const path = validateAbsPath(rawPath);
    await store.dismissRepo(path);
    hooks.onRepoDismissed?.(path);
  });

  handle(Channels.ReposPickDirectory, async (): Promise<string | null> => {
    const win = getMainWindow();
    const opts: Electron.OpenDialogOptions = {
      title: 'Add repo or folder',
      message:
        'Pick a git repo, worktree, or any folder. Git paths resolve to the parent repo; a non-git folder is pinned as a plain file tree.',
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
