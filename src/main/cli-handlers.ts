import { isAbsolute } from 'node:path';
import type { Repo, Worktree } from '@shared/types';
import type { CliHandlerMap } from './cli-server';

/**
 * Everything the CLI verbs need from the app, injected so the handler map is a
 * pure function of its dependencies (and therefore unit-testable without
 * Electron). Each dep maps onto logic the GUI already uses, so behaviour can't
 * drift between the mouse and the socket — the explicit goal in the idea note.
 */
export interface CliDeps {
  version: string;
  /** Tracked repos, from ReposStore.get().repos. */
  listRepos(): Repo[];
  /** Worktrees of a repo, from git.ts listWorktreesIn — the same call the IPC layer makes. */
  listWorktrees(repoPath: string): Promise<Worktree[]>;
  /** Surface a notification (native toast + window focus). Feeds agent notifications. */
  notify(text: string): void;
  /** Focus the window and open/focus the tab for `cwd` (drives the renderer). */
  openWorktree(cwd: string): void;
  /** Type `text` into the focused terminal pane (drives the renderer). */
  sendKeys(text: string): void;
}

function reqString(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error(`missing required argument: ${key}`);
  }
  return v;
}

/**
 * Resolve a `{repo, branch?}` selector to a worktree path. `repo` matches a
 * tracked repo by name, by absolute repo path, or (when no branch is given) by
 * an exact worktree path. With a branch, the repo's worktree on that branch is
 * returned; without one, the repo's primary (non-bare) worktree.
 */
export async function resolveWorktree(
  deps: Pick<CliDeps, 'listRepos' | 'listWorktrees'>,
  selector: { repo: string; branch?: string },
): Promise<string> {
  const { repo, branch } = selector;
  const repos = deps.listRepos();

  const match =
    repos.find((r) => r.name === repo || r.path === repo) ??
    // `repo` may itself be a path *inside* a tracked repo (e.g. a worktree dir).
    (isAbsolute(repo)
      ? repos.find((r) => repo === r.path || repo.startsWith(r.path + '/'))
      : undefined);

  if (!match) throw new Error(`unknown repo: ${repo}`);

  const worktrees = await deps.listWorktrees(match.path);

  if (branch) {
    const wt = worktrees.find((w) => w.branch === branch);
    if (!wt) throw new Error(`no worktree on branch "${branch}" in ${match.name}`);
    return wt.path;
  }

  // No branch: if the caller passed an exact worktree path, honour it.
  const exact = worktrees.find((w) => w.path === repo);
  if (exact) return exact.path;

  const primary = worktrees.find((w) => !w.isBare) ?? worktrees[0];
  if (!primary) throw new Error(`no worktrees in ${match.name}`);
  return primary.path;
}

/** Build the verb → handler map the CliServer dispatches against. */
export function buildCliHandlers(deps: CliDeps): CliHandlerMap {
  return {
    ping: () => ({ ok: true, app: 'treeline', version: deps.version }),

    repos: () => deps.listRepos(),

    worktrees: async (args) => {
      const repo = reqString(args, 'repo');
      const match = deps.listRepos().find((r) => r.name === repo || r.path === repo);
      if (!match) throw new Error(`unknown repo: ${repo}`);
      return deps.listWorktrees(match.path);
    },

    notify: (args) => {
      const text = reqString(args, 'text');
      deps.notify(text);
    },

    open: async (args) => {
      const repo = reqString(args, 'repo');
      const branch = typeof args['branch'] === 'string' ? args['branch'] : undefined;
      const cwd = await resolveWorktree(deps, { repo, branch });
      deps.openWorktree(cwd);
      return { opened: cwd };
    },

    send: (args) => {
      // `text` may legitimately be just a control char (e.g. ""), so only
      // the type is required here — empty string is allowed.
      const text = args['text'];
      if (typeof text !== 'string') throw new Error('missing required argument: text');
      deps.sendKeys(text);
      return { sent: text.length };
    },
  };
}
