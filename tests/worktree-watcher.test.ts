import { afterEach, describe, expect, it } from 'vitest';
import { WorktreeWatcher } from '../src/main/worktree-watcher';
import type { Worktree } from '../src/shared/types';

const flush = () => new Promise((r) => setTimeout(r, 0));

const wt = (path: string): Worktree =>
  ({ path, branch: 'main', commit: 'abc1234', isBare: false, dirty: false }) as Worktree;

let watchers: WorktreeWatcher[] = [];

/**
 * A watcher with polling effectively disabled (tests drive `refresh` by hand)
 * and a scripted lister. `exists` reports the repo as still on disk unless a
 * test says otherwise.
 */
function makeWatcher(
  list: (repoPath: string) => Promise<Worktree[]>,
  exists: (path: string) => boolean = () => true,
) {
  const w = new WorktreeWatcher(200, 60_000, list, exists);
  watchers.push(w);
  const changes: { repoPath: string; worktrees: Worktree[] }[] = [];
  w.on('change', (c: { repoPath: string; worktrees: Worktree[] }) => changes.push(c));
  return { w, changes };
}

afterEach(() => {
  for (const w of watchers) w.stop();
  watchers = [];
});

describe('WorktreeWatcher', () => {
  it('emits the worktree set on prime and again when it changes', async () => {
    let paths = ['/repo'];
    const { w, changes } = makeWatcher(async () => paths.map(wt));
    w.add('/repo');
    await flush();
    expect(changes.map((c) => c.worktrees.map((x) => x.path))).toEqual([['/repo']]);

    paths = ['/repo', '/repo/wt1'];
    await w.refresh('/repo');
    expect(changes.at(-1)?.worktrees.map((x) => x.path)).toEqual(['/repo', '/repo/wt1']);
  });

  it('does not re-emit when the set is unchanged', async () => {
    const { w, changes } = makeWatcher(async () => [wt('/repo')]);
    w.add('/repo');
    await flush();
    await w.refresh('/repo');
    expect(changes).toHaveLength(1);
  });

  it('keeps the last snapshot when a listing fails for a repo still on disk', async () => {
    let fail = false;
    const { w, changes } = makeWatcher(async () => {
      if (fail) throw new Error('git worktree list timed out after 15000ms');
      return [wt('/repo'), wt('/repo/wt1')];
    });
    w.add('/repo');
    await flush();
    expect(changes).toHaveLength(1);

    // A transient failure (timeout under load, waking from sleep) must not be
    // published as "this repo has no worktrees" …
    fail = true;
    await w.refresh('/repo');
    expect(changes).toHaveLength(1);
    expect(w.allWorktreePaths()).toEqual(['/repo', '/repo/wt1']);

    // … and must not make the recovery look like two worktrees appearing.
    fail = false;
    await w.refresh('/repo');
    expect(changes).toHaveLength(1);
  });

  it('surfaces an empty set when the repo itself is gone', async () => {
    let gone = false;
    const { w, changes } = makeWatcher(
      async () => {
        if (gone) throw new Error('not a git repository');
        return [wt('/repo')];
      },
      () => !gone,
    );
    w.add('/repo');
    await flush();

    gone = true;
    await w.refresh('/repo');
    expect(changes.at(-1)?.worktrees).toEqual([]);
    expect(w.allWorktreePaths()).toEqual([]);
  });
});
