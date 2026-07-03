import { isAbsolute } from 'node:path';
import type { Repo, Worktree } from '@shared/types';
import { normalizeBrowserUrl } from '@shared/browser-url';
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
  /**
   * Surface an agent-attention notification. When `paneId` is given (the Claude
   * Code hook reads it from TREELINE_PANE_ID), the app lights exactly that pane.
   * Otherwise, when `cwd` is given, it falls back to the PTY(s) running there
   * (ambiguous when two tabs share a directory); failing both, a native toast.
   */
  notify(text: string, cwd?: string, paneId?: string): void;
  /**
   * Record the Claude session id running in pane `paneId` (reported by the
   * SessionStart hook over the socket). Returns false when the pane is unknown
   * — the report is then dropped. Backs per-pane session pinning on save, so a
   * restored layout resumes each pane's actual conversation.
   */
  recordClaudeSession(paneId: string, sessionId: string): boolean;
  /** Focus the window and open/focus the tab for `cwd` (drives the renderer). */
  openWorktree(cwd: string): void;
  /** Type `text` into the focused terminal pane (drives the renderer). */
  sendKeys(text: string): void;
  /**
   * Open the embedded browser pane and point it at `url` (drives the renderer).
   * When `wait` is set, resolves only after the page finishes loading.
   */
  browserNavigate(url: string, wait: boolean): Promise<void>;
  /** Evaluate JS in the browser guest, resolving with its result (main-direct). */
  browserEval(code: string): Promise<unknown>;
  /** Capture the browser guest as a PNG data URL (main-direct). */
  browserScreenshot(): Promise<string>;
  /** Capture the browser guest to `path` (absolute) and resolve with the path. */
  browserScreenshotToFile(path: string): Promise<string>;
  /** Compact accessibility-tree snapshot of the guest page (main-direct, any origin). */
  browserSnapshot(): Promise<string>;
  /** Inspect a CSS selector without acting — descriptor of the first match or null. */
  browserQuery(selector: string): Promise<unknown>;
  /** Synthetic-click the element matched by `selector` (main-direct, local origins only). */
  browserClick(selector: string): Promise<unknown>;
  /** Fill the element matched by `selector` with `text` (main-direct, local origins only). */
  browserFill(selector: string, text: string): Promise<unknown>;
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
      const cwd = typeof args['cwd'] === 'string' && args['cwd'] ? args['cwd'] : undefined;
      const paneId =
        typeof args['paneId'] === 'string' && args['paneId'] ? args['paneId'] : undefined;
      deps.notify(text, cwd, paneId);
    },

    'claude-session': (args) => {
      const paneId = reqString(args, 'paneId');
      const sessionId = reqString(args, 'sessionId');
      // The id is later typed into a shell as `claude --resume <id>` on restore,
      // so accept only filename-shaped ids (Claude's are UUIDs) — never anything
      // the shell could interpret.
      if (!/^[A-Za-z0-9._-]{1,128}$/.test(sessionId)) {
        throw new Error(`malformed sessionId: ${JSON.stringify(sessionId)}`);
      }
      return { recorded: deps.recordClaudeSession(paneId, sessionId) };
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

    // Drive the embedded browser pane. `navigate` opens/points the pane (via the
    // renderer); `eval`/`screenshot` run against the guest webContents in main
    // and return a value. eval is gated to local origins in browser-guest.ts.
    browser: async (args) => {
      const action = reqString(args, 'action');
      switch (action) {
        case 'navigate': {
          const raw = reqString(args, 'url');
          const url = normalizeBrowserUrl(raw);
          if (!url) throw new Error(`not a navigable http(s) URL: ${raw}`);
          await deps.browserNavigate(url, args['wait'] === true);
          return { navigated: url };
        }
        case 'eval': {
          const code = reqString(args, 'code');
          return { result: await deps.browserEval(code) };
        }
        case 'screenshot': {
          const path = args['path'];
          if (path !== undefined && (typeof path !== 'string' || path.length === 0)) {
            throw new Error('browser screenshot path must be a non-empty string');
          }
          if (typeof path === 'string') {
            return { saved: await deps.browserScreenshotToFile(path) };
          }
          return { screenshot: await deps.browserScreenshot() };
        }
        case 'snapshot':
          return { snapshot: await deps.browserSnapshot() };
        case 'query': {
          const selector = reqString(args, 'selector');
          return { element: await deps.browserQuery(selector) };
        }
        case 'click': {
          const selector = reqString(args, 'selector');
          return await deps.browserClick(selector);
        }
        case 'fill': {
          const selector = reqString(args, 'selector');
          const text = args['text'];
          if (typeof text !== 'string') throw new Error('missing required argument: text');
          return await deps.browserFill(selector, text);
        }
        default:
          throw new Error(
            `unknown browser action: ${action} (expected navigate|eval|screenshot|snapshot|query|click|fill)`,
          );
      }
    },
  };
}
