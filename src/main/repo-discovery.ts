import { EventEmitter } from 'node:events';
import { repoRootAt } from './git';

/** Resolves a cwd to its containing repo's toplevel, or null if not in a repo. */
export type ToplevelResolver = (cwd: string) => Promise<string | null>;

/** Cached classification of a single cwd. */
type Resolution =
  | { kind: 'tracked' }
  | { kind: 'dismissed' }
  | { kind: 'discovered'; repoPath: string }
  | { kind: 'not-in-repo' };

export interface DiscoveredRepoEvent {
  /** Toplevel of the untracked repo we noticed via a PTY's cwd. */
  repoPath: string;
  /** The cwd that triggered the discovery — useful context for the toast. */
  viaCwd: string;
}

/**
 * Hard cap on the per-cwd resolution cache. A user could `cd` into many
 * directories in a session; bounding the cache keeps `git rev-parse` calls
 * O(unique-cwds) without growing memory unbounded. Eviction is FIFO via
 * Map insertion order.
 */
const CACHE_MAX = 1024;

/**
 * Watches PTY cwds and surfaces git repos that aren't currently tracked or
 * dismissed. Subscribes to `cwd-changed` events from the caller (typically
 * `PtyManager`) via `onCwd(cwd)`.
 *
 * Two gates protect against spam:
 *   1. **Per-cwd resolution cache.** A repeat `onCwd` for the same path is
 *      O(1); only a brand-new cwd hits `git rev-parse`.
 *   2. **Tracked + dismissed sets.** A cwd inside any tracked repo path is
 *      classified `tracked` without calling git; a cwd whose toplevel is on
 *      the dismissed list is classified `dismissed` and never re-emitted.
 *
 * The cache is cleared whenever the tracked or dismissed sets change, so a
 * just-added repo doesn't leave stale `discovered` entries pointing at it.
 *
 * Emits:
 *   - 'discovered-repo' { repoPath, viaCwd }
 */
export class RepoDiscovery extends EventEmitter {
  private trackedPaths: string[] = [];
  private dismissed = new Set<string>();
  /** path → resolution. Insertion-ordered for FIFO eviction. */
  private readonly cache = new Map<string, Resolution>();

  constructor(private readonly resolver: ToplevelResolver = defaultResolver) {
    super();
  }

  /**
   * Set the current list of tracked repo toplevels. Sorted longest-first
   * internally so prefix matching can short-circuit.
   */
  setTrackedRepos(paths: string[]): void {
    this.trackedPaths = [...new Set(paths)].sort((a, b) => b.length - a.length);
    this.cache.clear();
  }

  setDismissedRepos(paths: string[]): void {
    this.dismissed = new Set(paths);
    this.cache.clear();
  }

  /**
   * Classify a cwd. Emits `discovered-repo` if it resolves to an untracked,
   * non-dismissed repo — and only the first time per unique repo (subsequent
   * cwds inside the same untracked repo are cached as `discovered` and stay
   * silent until something invalidates the cache).
   */
  async onCwd(cwd: string): Promise<void> {
    if (!cwd) return;

    const cached = this.cache.get(cwd);
    if (cached) return; // Any prior classification is final until cache reset.

    // Cheap prefix match against tracked repos before shelling out to git.
    if (this.isUnderTracked(cwd)) {
      this.recordResolution(cwd, { kind: 'tracked' });
      return;
    }

    let toplevel: string | null;
    try {
      toplevel = await this.resolver(cwd);
    } catch {
      // Treat git failures as "not in a repo" so a one-off error doesn't
      // re-trigger every cwd-changed for the same path.
      this.recordResolution(cwd, { kind: 'not-in-repo' });
      return;
    }

    if (!toplevel) {
      this.recordResolution(cwd, { kind: 'not-in-repo' });
      return;
    }

    // The resolver may return a path not equal to cwd (cwd was a subdir of
    // the worktree). Re-check both gates against the toplevel.
    if (this.isUnderTracked(toplevel)) {
      this.recordResolution(cwd, { kind: 'tracked' });
      return;
    }
    if (this.dismissed.has(toplevel)) {
      this.recordResolution(cwd, { kind: 'dismissed' });
      return;
    }

    // First time seeing this untracked repo — surface it. Cache so we don't
    // re-emit on subsequent cwds in the same repo.
    this.recordResolution(cwd, { kind: 'discovered', repoPath: toplevel });
    this.emit('discovered-repo', { repoPath: toplevel, viaCwd: cwd } satisfies DiscoveredRepoEvent);
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private isUnderTracked(path: string): boolean {
    for (const tracked of this.trackedPaths) {
      if (path === tracked || path.startsWith(tracked + '/')) return true;
    }
    return false;
  }

  private recordResolution(cwd: string, res: Resolution): void {
    if (this.cache.size >= CACHE_MAX) {
      // FIFO eviction — Map preserves insertion order.
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(cwd, res);
  }
}

/**
 * Default resolver — runs `git -C <cwd> rev-parse --show-toplevel`. Exported
 * separately so tests can compose around it if they want to.
 */
export const defaultResolver: ToplevelResolver = (cwd) => repoRootAt(cwd);
