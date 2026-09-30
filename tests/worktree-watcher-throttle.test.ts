import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorktreeWatcher } from '../src/main/worktree-watcher';
import type { Worktree } from '../src/shared/types';

const wt = (path: string): Worktree => ({
  path,
  branch: 'main',
  commit: 'abc1234',
  isBare: false,
  isDirty: false,
  isCurrent: false,
  isClaude: false,
  merged: false,
});

const POLL_MS = 1000;
const IDLE_POLL_MS = 10_000;

/**
 * Fake-timer harness: the lister records which repo was listed and when, so a
 * test can count polls per repo. `fs.watch` is irrelevant here — the repo paths
 * don't exist on disk, so no watcher is attached and only the poll timer fires.
 */
function makeWatcher() {
  const listed: Record<string, number> = {};
  const list = vi.fn(async (repoPath: string) => {
    listed[repoPath] = (listed[repoPath] ?? 0) + 1;
    return [wt(repoPath)];
  });
  const w = new WorktreeWatcher(200, POLL_MS, list, () => true, IDLE_POLL_MS);
  return { w, listed };
}

async function prime(w: WorktreeWatcher, ...repos: string[]) {
  for (const r of repos) w.add(r);
  await vi.advanceTimersByTimeAsync(0);
}

describe('WorktreeWatcher poll throttling', () => {
  let w: WorktreeWatcher | null = null;
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    w?.stop();
    w = null;
    vi.useRealTimers();
  });

  it('polls every repo at full cadence until the renderer reports activity', async () => {
    const h = makeWatcher();
    w = h.w;
    await prime(w, '/a', '/b');
    expect(h.listed).toEqual({ '/a': 1, '/b': 1 });

    await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    expect(h.listed).toEqual({ '/a': 4, '/b': 4 });
  });

  it('polls inactive repos only every idlePollMs once activity is known', async () => {
    const h = makeWatcher();
    w = h.w;
    await prime(w, '/a', '/b');
    w.setActiveRepos(['/a']);

    await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    expect(h.listed['/a']).toBe(4);
    expect(h.listed['/b']).toBe(1); // library repo: no poll yet

    // The idle clock runs from the prime. '/b' was the second repo added, so
    // it carries one tick of skew: not due at idlePollMs, due one tick later,
    // then quiet again for the rest of the period.
    await vi.advanceTimersByTimeAsync(IDLE_POLL_MS - POLL_MS * 3);
    expect(h.listed['/b']).toBe(1);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(h.listed['/b']).toBe(2);
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    expect(h.listed['/b']).toBe(2);

    // The skew only shifts the phase: the next sweep is exactly idlePollMs
    // after the last listing, not idlePollMs plus the skew again.
    await vi.advanceTimersByTimeAsync(IDLE_POLL_MS - POLL_MS * 4);
    expect(h.listed['/b']).toBe(2);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(h.listed['/b']).toBe(3);
  });

  it('reuses the skew slot a removed repo vacated', async () => {
    const h = makeWatcher();
    w = h.w;
    await prime(w, '/a', '/b', '/c'); // slots 0, 1, 2
    w.remove('/b');
    w.add('/d'); // must take slot 1 (vacated), not 3
    await vi.advanceTimersByTimeAsync(0);
    w.setActiveRepos([]);

    await vi.advanceTimersByTimeAsync(IDLE_POLL_MS + POLL_MS);
    expect(h.listed['/d']).toBe(2);
    expect(h.listed['/c']).toBe(1);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(h.listed['/c']).toBe(2);
  });

  it('staggers the idle sweep so library repos do not all list on one tick', async () => {
    const h = makeWatcher();
    w = h.w;
    // Twelve repos, ten ticks per idle period: they must not all come due
    // together at idlePollMs, and each still lists exactly once per sweep.
    const repos = Array.from({ length: 12 }, (_, i) => `/r${i}`);
    await prime(w, ...repos);
    w.setActiveRepos([]);
    // One idle period plus the longest skew: every repo comes due exactly
    // once in this span, and none a second time.
    const ticksPerPeriod = IDLE_POLL_MS / POLL_MS;
    const perTick: number[] = [];
    for (let t = 0; t < 2 * ticksPerPeriod - 1; t++) {
      const before = Object.values(h.listed).reduce((a, b) => a + b, 0);
      await vi.advanceTimersByTimeAsync(POLL_MS);
      perTick.push(Object.values(h.listed).reduce((a, b) => a + b, 0) - before);
    }
    expect(Math.max(...perTick)).toBeLessThan(repos.length);
    for (const r of repos) expect(h.listed[r]).toBe(2); // prime + one sweep
  });

  it('refreshes a repo immediately when it becomes active', async () => {
    const h = makeWatcher();
    w = h.w;
    await prime(w, '/a');
    w.setActiveRepos([]);
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    expect(h.listed['/a']).toBe(1);

    // Opening a tab in a library repo must not leave its dirty dot stale for
    // up to idlePollMs — the promotion itself triggers a listing.
    w.setActiveRepos(['/a']);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.listed['/a']).toBe(2);
    // …and it is back on the fast cadence.
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(h.listed['/a']).toBe(3);
  });

  it('pauses polling while the window is hidden and catches up on show', async () => {
    const h = makeWatcher();
    w = h.w;
    await prime(w, '/a', '/b');
    w.setActiveRepos(['/a']);

    w.setVisible(false);
    await vi.advanceTimersByTimeAsync(IDLE_POLL_MS * 2);
    expect(h.listed).toEqual({ '/a': 1, '/b': 1 }); // nothing while hidden

    w.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.listed).toEqual({ '/a': 2, '/b': 1 }); // active catches up at once
    // The library repo is re-phased to its skew slot (one tick for '/b')
    // rather than listed in the same instant.
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(h.listed).toEqual({ '/a': 3, '/b': 2 });
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(h.listed).toEqual({ '/a': 4, '/b': 2 }); // then only the active one
  });

  it('staggers the library catch-up on show instead of bursting', async () => {
    const h = makeWatcher();
    w = h.w;
    const repos = Array.from({ length: 12 }, (_, i) => `/r${i}`);
    await prime(w, ...repos);
    w.setActiveRepos([]);
    w.setVisible(false);
    await vi.advanceTimersByTimeAsync(IDLE_POLL_MS * 3); // every idle period lapsed
    for (const r of repos) expect(h.listed[r]).toBe(1);

    // Un-minimising must not fire one `git status` sweep per repo at once:
    // nothing lists in the show instant, and the catch-up is spread over the
    // ticks of one idle period with every repo listed exactly once.
    w.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    for (const r of repos) expect(h.listed[r]).toBe(1);
    const ticksPerPeriod = IDLE_POLL_MS / POLL_MS;
    const perTick: number[] = [];
    for (let t = 0; t < ticksPerPeriod; t++) {
      const before = Object.values(h.listed).reduce((a, b) => a + b, 0);
      await vi.advanceTimersByTimeAsync(POLL_MS);
      perTick.push(Object.values(h.listed).reduce((a, b) => a + b, 0) - before);
    }
    expect(Math.max(...perTick)).toBeLessThan(repos.length);
    for (const r of repos) expect(h.listed[r]).toBe(2);
  });

  it('still refreshes on an explicit request while hidden or inactive', async () => {
    // fs.watch and UI-driven refreshes bypass the throttle: a `git worktree
    // add` in a library repo, or a commit while minimised, must still land.
    const h = makeWatcher();
    w = h.w;
    await prime(w, '/a');
    w.setActiveRepos([]);
    w.setVisible(false);
    await w.refresh('/a');
    expect(h.listed['/a']).toBe(2);
  });
});
