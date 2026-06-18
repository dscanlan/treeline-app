// Polls GitHub PR status per tracked repo via the `gh` CLI and broadcasts
// deltas to the renderer — the same EventEmitter + timer + emit-on-change
// pattern as ProcessMonitor / WorktreeWatcher, but on a slow cadence (network
// + GitHub rate limits) with a per-repo overlap guard.

import { EventEmitter } from 'node:events';
import type { PrInfo, PrSnapshot } from '@shared/types';
import { ghAvailable, listPullRequests } from './gh';

/** Default poll cadence. Well under GitHub's 5000-req/hr authenticated limit. */
const DEFAULT_TICK_MS = 60_000;

/** Per-repo fetch fn — injectable so tests don't shell out to `gh`. */
export type PrFetchFn = (repoPath: string) => Promise<Record<string, PrInfo>>;

interface RepoEntry {
  /** Stable JSON snapshot of the last-broadcast branch→PrInfo map. */
  cache: string;
  refreshing: boolean;
}

/**
 * Emits:
 *   - 'update' { repoPath, prByBranch }  — only when a repo's PR set changes.
 *
 * No-ops entirely if `gh` isn't installed (probed once in `start()`).
 */
export class PrMonitor extends EventEmitter {
  private readonly repos = new Map<string, RepoEntry>();
  private timer: NodeJS.Timeout | null = null;
  private enabled = false;

  constructor(
    private readonly tickMs: number = DEFAULT_TICK_MS,
    private readonly fetch: PrFetchFn = listPullRequests,
    /** Override the availability probe (tests). */
    private readonly probe: () => Promise<boolean> = ghAvailable,
  ) {
    super();
  }

  async start(): Promise<void> {
    if (this.timer) return;
    this.enabled = await this.probe();
    if (!this.enabled) return; // gh absent — stay dormant, no badges.
    this.timer = setInterval(() => void this.tick(), this.tickMs);
    void this.tick(); // prime immediately.
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Set the repos to poll. Adds entries for new paths (and refreshes them now)
   * and drops entries for paths no longer tracked.
   */
  setRepoPaths(paths: string[]): void {
    const next = new Set(paths);
    for (const p of this.repos.keys()) {
      if (!next.has(p)) this.repos.delete(p);
    }
    for (const p of next) {
      if (!this.repos.has(p)) {
        this.repos.set(p, { cache: '', refreshing: false });
        if (this.enabled) void this.refreshRepo(p);
      }
    }
  }

  /** Poll every tracked repo in parallel. Public for tests. */
  async tick(): Promise<void> {
    await Promise.all([...this.repos.keys()].map((p) => this.refreshRepo(p)));
  }

  /**
   * Refresh a single repo and emit if its PR set changed. Coalesces overlapping
   * calls (a `gh` fetch can be slow) by skipping while one is in flight — the
   * next tick or worktree-change picks up any missed update. Public so the
   * worktree-change hook can trigger a targeted refresh.
   */
  async refreshRepo(repoPath: string): Promise<void> {
    if (!this.enabled) return;
    const entry = this.repos.get(repoPath);
    if (!entry || entry.refreshing) return;
    entry.refreshing = true;
    let prByBranch: Record<string, PrInfo>;
    try {
      prByBranch = await this.fetch(repoPath);
    } catch {
      // listPullRequests already degrades to {}; this guards an injected fetch.
      return;
    } finally {
      entry.refreshing = false;
    }
    // The repo may have been removed mid-fetch.
    if (!this.repos.has(repoPath)) return;
    const nextCache = JSON.stringify(prByBranch);
    if (nextCache === entry.cache) return;
    entry.cache = nextCache;
    const snapshot: PrSnapshot = { repoPath, prByBranch };
    this.emit('update', snapshot);
  }
}
