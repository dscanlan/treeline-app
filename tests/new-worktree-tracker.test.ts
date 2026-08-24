import { describe, expect, it } from 'vitest';
import { NewWorktreeTracker } from '../src/main/new-worktree-tracker';

const repo = '/repo';
const wt = (n: number) => `/repo/wt/${n}`;
const many = (n: number) => Array.from({ length: n }, (_, i) => wt(i));

describe('NewWorktreeTracker', () => {
  it('seeds silently on the first snapshot for a repo', () => {
    const t = new NewWorktreeTracker();
    expect(t.observe(repo, [repo, wt(1), wt(2)])).toEqual([]);
  });

  it('reports a worktree added after seeding', () => {
    const t = new NewWorktreeTracker();
    t.observe(repo, [repo]);
    expect(t.observe(repo, [repo, wt(1)])).toEqual([wt(1)]);
  });

  it('reports nothing when the set is unchanged', () => {
    const t = new NewWorktreeTracker();
    t.observe(repo, [repo, wt(1)]);
    // The watcher also emits on dirty/branch changes, which re-send the same
    // path set — those must not prompt.
    expect(t.observe(repo, [repo, wt(1)])).toEqual([]);
    expect(t.observe(repo, [wt(1), repo])).toEqual([]);
  });

  it('reports nothing when worktrees are removed', () => {
    const t = new NewWorktreeTracker();
    t.observe(repo, [repo, wt(1), wt(2)]);
    expect(t.observe(repo, [repo])).toEqual([]);
  });

  it('swallows an implausible burst instead of prompting per path', () => {
    const t = new NewWorktreeTracker();
    // A snapshot that briefly listed short (failed/partial listing)…
    t.observe(repo, [repo]);
    // …then recovers with the whole repo's worktrees at once. None of these
    // are new; announcing them all is the "+47 more" toast pile-up.
    expect(t.observe(repo, [repo, ...many(47)])).toEqual([]);
  });

  it('re-seeds from a swallowed burst, so the next real add still prompts', () => {
    const t = new NewWorktreeTracker();
    t.observe(repo, [repo]);
    t.observe(repo, [repo, ...many(47)]);
    expect(t.observe(repo, [repo, ...many(47), wt(99)])).toEqual([wt(99)]);
  });

  it('tracks repos independently', () => {
    const t = new NewWorktreeTracker();
    t.observe('/a', ['/a']);
    // First sighting of /b seeds, and must not be diffed against /a.
    expect(t.observe('/b', ['/b', '/b/wt'])).toEqual([]);
    expect(t.observe('/a', ['/a', '/a/wt'])).toEqual(['/a/wt']);
  });
});
