// Pure-ish "create a new repo" logic: validation + filesystem prep + `git init`
// + store registration. Kept out of `ipc/repos.ts` so it's testable without
// spinning up an Electron `ipcMain` shim. The IPC handler is a thin wrapper.
import { constants as fsConstants } from 'node:fs';
import { access, mkdir, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Repo } from '@shared/types';
import { initRepo, isGitRepo } from './git';
import type { ReposStore } from './repos-store';
import {
  validateAbsPath,
  validateBranchName,
  validateFolderName,
} from './util/safe-path';

export interface CreateRepoOpts {
  /** `new-folder`: mkdir under basePath. `existing-folder`: init in basePath. */
  mode: 'new-folder' | 'existing-folder';
  /** Parent dir (new-folder) or target dir (existing-folder). */
  basePath: string;
  /** Required iff mode === 'new-folder'. */
  folderName?: string;
  /** Initial branch name, passed to `git init -b`. */
  branch: string;
}

/**
 * Validates `opts`, prepares the target directory, runs `git init`, and
 * registers the new repo with `store.addRepo()`. Returns the registered Repo.
 *
 * On any validation failure, throws before touching the filesystem (except
 * the new-folder mkdir, which is the last step before `git init`). If
 * `git init` fails after the mkdir, the empty folder is left on disk — the
 * user can retry or remove it themselves. Cleaning up on failure would
 * require distinguishing "we created this dir just now" from "this dir
 * already existed and we partially populated it", and the new-folder case
 * always pre-checks non-existence so a leaked empty dir is the worst case.
 */
export async function createRepo(
  store: ReposStore,
  opts: CreateRepoOpts,
): Promise<Repo> {
  if (!opts || typeof opts !== 'object') {
    throw new Error('opts must be an object');
  }
  if (opts.mode !== 'new-folder' && opts.mode !== 'existing-folder') {
    throw new Error('mode must be "new-folder" or "existing-folder"');
  }
  const basePath = validateAbsPath(opts.basePath);
  const branch = validateBranchName(opts.branch);

  let target: string;
  if (opts.mode === 'new-folder') {
    const folderName = validateFolderName(opts.folderName);

    // Parent must exist as a writable directory.
    const parentStat = await stat(basePath).catch(() => null);
    if (!parentStat?.isDirectory()) {
      throw new Error(`Parent is not a directory: ${basePath}`);
    }
    await access(basePath, fsConstants.W_OK).catch(() => {
      throw new Error(`Parent not writable: ${basePath}`);
    });

    target = join(basePath, folderName);
    const targetStat = await stat(target).catch(() => null);
    if (targetStat) {
      throw new Error(`Already exists: ${target}`);
    }
    await mkdir(target, { recursive: false });
  } else {
    // existing-folder
    const s = await stat(basePath).catch(() => null);
    if (!s) throw new Error(`Path does not exist: ${basePath}`);
    if (!s.isDirectory()) throw new Error(`Not a directory: ${basePath}`);
    if (await isGitRepo(basePath)) {
      throw new Error(`Already a git repo: ${basePath}`);
    }
    // Treat `.DS_Store` as empty — it's a macOS Finder artifact, not user
    // content. Anything else means the user picked the wrong folder.
    const entries = await readdir(basePath);
    const significant = entries.filter((e) => e !== '.DS_Store');
    if (significant.length > 0) {
      throw new Error(`Directory not empty: ${basePath}`);
    }
    target = basePath;
  }

  await initRepo(target, branch);
  return store.addRepo(target);
}
