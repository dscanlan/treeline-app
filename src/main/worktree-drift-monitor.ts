import { EventEmitter } from 'node:events';
import { longestPrefixMatch } from './process-monitor';

export interface WorktreeDriftEvent {
  /** The PTY whose cwd drifted into a different worktree. */
  ptyId: string;
  /** Worktree the PTY was rooted in when it spawned (null if outside any). */
  fromWorktree: string | null;
  /** Worktree the PTY's cwd has moved into. Always non-null. */
  toWorktree: string;
}

/**
 * Notices when a hosted terminal's cwd moves into a *different* worktree than
 * the one its tab was rooted in — the classic "`git worktree add ../feat &&
 * cd ../feat`" flow, where treeline would otherwise keep treating the tab as if
 * work were still happening in the original worktree.
 *
 * Sibling to {@link RepoDiscovery}: both subscribe to `PtyManager`'s
 * `cwd-changed`, but `RepoDiscovery` handles *untracked* repos while this
 * handles drift *within* the set of tracked worktrees. Membership is decided
 * purely with `longestPrefixMatch` against the known worktree paths — no git
 * calls.
 *
 * Per PTY, the first `onCwd` (which fires at spawn) establishes the **home**
 * worktree; a later cwd that resolves to a different, non-null worktree fires
 * `worktree-drift` once. A `lastEmittedByPty` guard keeps repeated OSC 7 ticks
 * at the same path from re-firing.
 *
 * Emits:
 *   - 'worktree-drift' { ptyId, fromWorktree, toWorktree }
 */
export class WorktreeDriftMonitor extends EventEmitter {
  /** Known worktree toplevels, sorted longest-first for prefix matching. */
  private worktreePaths: string[] = [];
  /** ptyId → the worktree it was rooted in on its first cwd (may be null). */
  private readonly homeByPty = new Map<string, string | null>();
  /** ptyId → the last worktree we emitted a drift toward (dedup). */
  private readonly lastEmittedByPty = new Map<string, string>();

  setWorktreePaths(paths: string[]): void {
    this.worktreePaths = [...new Set(paths)].sort((a, b) => b.length - a.length);
  }

  /**
   * Classify a PTY's current cwd. The first call for a ptyId records its home
   * worktree silently; subsequent calls emit `worktree-drift` when the cwd
   * resolves to a different, known worktree (deduped per target).
   */
  onCwd(ptyId: string, cwd: string): void {
    if (!ptyId || !cwd) return;
    const current = longestPrefixMatch(this.worktreePaths, cwd);

    if (!this.homeByPty.has(ptyId)) {
      this.homeByPty.set(ptyId, current);
      return;
    }

    const home = this.homeByPty.get(ptyId) ?? null;
    // Only interested in moves into a recognised worktree that differs from
    // home. (cd within the same worktree, or out into untracked space, is a
    // no-op — the latter is RepoDiscovery's job.)
    if (!current || current === home) return;
    if (this.lastEmittedByPty.get(ptyId) === current) return;

    this.lastEmittedByPty.set(ptyId, current);
    this.emit('worktree-drift', {
      ptyId,
      fromWorktree: home,
      toWorktree: current,
    } satisfies WorktreeDriftEvent);
  }

  /** Drop per-PTY state when a terminal exits, so the maps don't grow. */
  release(ptyId: string): void {
    this.homeByPty.delete(ptyId);
    this.lastEmittedByPty.delete(ptyId);
  }
}
