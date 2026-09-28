import { existsSync, watch, type FSWatcher } from 'node:fs';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { listWorktreesIn } from './git';
import type { Worktree } from '@shared/types';

interface RepoEntry {
  watcher: FSWatcher | null;
  pollTimer: NodeJS.Timeout;
  debounceTimer: NodeJS.Timeout | null;
  cache: string; // Stable JSON snapshot of the last-known worktree set.
  refreshing: boolean;
  refreshQueued: boolean;
  snapshotVersion: number;
  /** Epoch ms when the last listing started; the idle poll's clock. */
  lastListedAt: number;
  /** Per-repo offset added to idlePollMs so library repos don't sweep in lockstep. */
  idleSkewMs: number;
}

/**
 * Watches each tracked repo's `.git/worktrees` directory for changes and emits
 * `change` { repoPath, worktrees } when the set differs from the cached
 * snapshot. Combines fs.watch (sub-100ms latency on FSEvents-backed paths)
 * with a 5s polling fallback to catch missed events.
 *
 * The poll is what keeps the sidebar's dirty dot honest — `.git` never changes
 * when the user merely edits a file — but each tick costs a `git status` per
 * worktree, which with dozens of repos and a hundred worktrees is a permanent
 * stream of tree walks (and, under endpoint-protection on-access scanning, a
 * CPU fire). So the poll is throttled by *activity*: repos the renderer reports
 * as active (open tabs, running agents, pins — the sidebar's "Working" set)
 * poll every `pollMs`; everything else (the "Library") only every
 * `idlePollMs`. While the window is hidden nobody can see a dirty dot, so the
 * poll pauses entirely. fs.watch keeps firing throughout, so a
 * `git worktree add` in a library repo, or a commit while minimised, is still
 * picked up immediately.
 *
 * A snapshot is only published when it was actually read: a failed listing for
 * a repo that's still on disk is dropped rather than reported as "no worktrees"
 * (see {@link WorktreeWatcher.refresh}), so downstream diffing can trust that a
 * path disappearing means it was really removed.
 *
 * Emits:
 *   - 'change' { repoPath: string; worktrees: Worktree[] }
 */
export class WorktreeWatcher extends EventEmitter {
  private readonly repos = new Map<string, RepoEntry>();

  constructor(
    private readonly debounceMs = 200,
    private readonly pollMs = 5000,
    private readonly list: (repoPath: string) => Promise<Worktree[]> = listWorktreesIn,
    private readonly exists: (path: string) => boolean = existsSync,
    private readonly idlePollMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {
    super();
  }

  /**
   * Repo paths whose worktrees are in use (see `activeRepoPaths` in
   * `sidebar-model`). `null` — the state before the renderer has reported —
   * means "treat every repo as active", so an old renderer or screenshot mode
   * gets the pre-throttle behaviour rather than a stale sidebar.
   */
  private activeRepos: Set<string> | null = null;
  private visible = true;

  setActiveRepos(repoPaths: Iterable<string> | null): void {
    const prev = this.activeRepos;
    this.activeRepos = repoPaths === null ? null : new Set(repoPaths);
    if (prev === null) return;
    // A repo promoted to active may have gone unpolled for up to idlePollMs;
    // catch it up now rather than making the user wait a tick.
    for (const repoPath of this.repos.keys()) {
      if (this.isActive(repoPath) && !prev.has(repoPath)) void this.refresh(repoPath);
    }
  }

  /** Window visibility: the poll pauses while hidden and catches up on show. */
  setVisible(visible: boolean): void {
    const wasVisible = this.visible;
    this.visible = visible;
    if (visible && !wasVisible) {
      for (const repoPath of this.repos.keys()) void this.refresh(repoPath);
    }
  }

  private isActive(repoPath: string): boolean {
    return this.activeRepos === null || this.activeRepos.has(repoPath);
  }

  /** The poll timer's tick: refresh only if this repo is due. */
  private pollTick(repoPath: string): void {
    const entry = this.repos.get(repoPath);
    if (!entry || !this.visible) return;
    if (!this.isActive(repoPath)) {
      // Every repo was primed in the same instant at startup, so without a
      // per-repo skew the whole library would come due on the same tick and
      // re-create the very burst the throttle exists to prevent. Spread the
      // idle sweep across the ticks of one idle period instead.
      const due = this.idlePollMs + entry.idleSkewMs;
      if (this.now() - entry.lastListedAt < due) return;
    }
    void this.refresh(repoPath);
  }

  add(repoPath: string): void {
    if (this.repos.has(repoPath)) return;
    const entry: RepoEntry = {
      watcher: null,
      pollTimer: setInterval(() => this.pollTick(repoPath), this.pollMs),
      debounceTimer: null,
      cache: '',
      refreshing: false,
      refreshQueued: false,
      snapshotVersion: 0,
      lastListedAt: 0,
      // Deterministic round-robin over the poll ticks in one idle period:
      // the k-th repo added waits k extra ticks (mod the period), so N repos
      // spread over idlePollMs/pollMs ticks instead of landing together.
      idleSkewMs: (this.repos.size % Math.max(1, Math.floor(this.idlePollMs / this.pollMs))) * this.pollMs,
    };
    this.repos.set(repoPath, entry);

    // Watch `<repo>/.git` non-recursively so we pick up the `worktrees` dir
    // appearing/disappearing even on a single-checkout repo.
    const gitDir = join(repoPath, '.git');
    if (existsSync(gitDir)) {
      try {
        entry.watcher = watch(gitDir, { persistent: false }, () => {
          this.scheduleRefresh(repoPath);
        });
      } catch {
        // Some filesystems don't support fs.watch; rely on the poll fallback.
      }
    }

    // Prime the cache.
    void this.refresh(repoPath);
  }

  remove(repoPath: string): void {
    const entry = this.repos.get(repoPath);
    if (!entry) return;
    entry.watcher?.close();
    clearInterval(entry.pollTimer);
    if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
    this.repos.delete(repoPath);
  }

  /** All currently-known worktree paths across every tracked repo. */
  allWorktreePaths(): string[] {
    const out: string[] = [];
    for (const entry of this.repos.values()) {
      try {
        const arr = JSON.parse(entry.cache) as Worktree[];
        for (const w of arr) out.push(w.path);
      } catch {
        /* cache may be empty before first refresh */
      }
    }
    return out;
  }

  stop(): void {
    for (const repoPath of [...this.repos.keys()]) this.remove(repoPath);
  }

  /** Keep explicit UI refreshes and background polling on the same snapshot. */
  setSnapshot(repoPath: string, worktrees: Worktree[]): void {
    const entry = this.repos.get(repoPath);
    if (!entry) return;
    // A listing already in flight must not overwrite this newer observation.
    entry.snapshotVersion += 1;
    const next = JSON.stringify(worktrees);
    if (next === entry.cache) return;
    entry.cache = next;
    this.emit('change', { repoPath, worktrees });
  }

  /** Force a refresh now (debounced via scheduleRefresh; this skips the wait). */
  async refresh(repoPath: string): Promise<void> {
    const entry = this.repos.get(repoPath);
    if (!entry) return;
    // listWorktreesIn spawns a `git status` per worktree and can run for many
    // seconds on a large tree, while the poll fires every 5s — without a guard
    // the overlapping refreshes pile up git processes. Coalesce: remember that
    // another refresh was requested and run one trailing pass instead.
    if (entry.refreshing) {
      entry.refreshQueued = true;
      return;
    }
    entry.refreshing = true;
    entry.lastListedAt = this.now();
    const snapshotVersion = entry.snapshotVersion;
    // null = the listing failed transiently, so we have nothing trustworthy to
    // report (distinct from a real, empty [] for a repo that's gone).
    let worktrees: Worktree[] | null;
    try {
      worktrees = await this.list(repoPath);
    } catch {
      // The listing failed. If the repo is gone from disk that's real state —
      // surface it as empty. Otherwise it's transient (a `git worktree list`
      // that blew its timeout under load, a machine waking from sleep with the
      // call in flight, a briefly unreadable .git) and publishing an empty set
      // would *poison* the snapshot: consumers diff consecutive snapshots to
      // spot newly-created worktrees, so the next successful pass would report
      // every worktree in the repo as brand new. Keep the last-known snapshot
      // and let the poll retry.
      worktrees = this.exists(join(repoPath, '.git')) ? null : [];
    } finally {
      entry.refreshing = false;
    }
    if (entry.refreshQueued && this.repos.has(repoPath)) {
      entry.refreshQueued = false;
      void this.refresh(repoPath);
    }
    if (worktrees === null || this.repos.get(repoPath) !== entry) return;
    if (entry.snapshotVersion !== snapshotVersion) return;
    this.setSnapshot(repoPath, worktrees);
  }

  private scheduleRefresh(repoPath: string): void {
    const entry = this.repos.get(repoPath);
    if (!entry) return;
    if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
    entry.debounceTimer = setTimeout(() => {
      entry.debounceTimer = null;
      void this.refresh(repoPath);
    }, this.debounceMs);
  }
}
