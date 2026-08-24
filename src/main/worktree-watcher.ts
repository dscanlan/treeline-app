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
}

/**
 * Watches each tracked repo's `.git/worktrees` directory for changes and emits
 * `change` { repoPath, worktrees } when the set differs from the cached
 * snapshot. Combines fs.watch (sub-100ms latency on FSEvents-backed paths)
 * with a 5s polling fallback to catch missed events.
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
  ) {
    super();
  }

  add(repoPath: string): void {
    if (this.repos.has(repoPath)) return;
    const entry: RepoEntry = {
      watcher: null,
      pollTimer: setInterval(() => this.refresh(repoPath), this.pollMs),
      debounceTimer: null,
      cache: '',
      refreshing: false,
      refreshQueued: false,
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
    if (worktrees === null) return;
    const next = JSON.stringify(worktrees);
    if (next === entry.cache) return;
    entry.cache = next;
    this.emit('change', { repoPath, worktrees });
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
