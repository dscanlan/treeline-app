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
 * Emits:
 *   - 'change' { repoPath: string; worktrees: Worktree[] }
 */
export class WorktreeWatcher extends EventEmitter {
  private readonly repos = new Map<string, RepoEntry>();

  constructor(private readonly debounceMs = 200, private readonly pollMs = 5000) {
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
    let worktrees: Worktree[];
    try {
      worktrees = await listWorktreesIn(repoPath);
    } catch {
      // Repo dir may have been deleted out from under us; surface as empty.
      worktrees = [];
    } finally {
      entry.refreshing = false;
    }
    if (entry.refreshQueued && this.repos.has(repoPath)) {
      entry.refreshQueued = false;
      void this.refresh(repoPath);
    }
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
