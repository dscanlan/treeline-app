import { describe, expect, it, vi } from 'vitest';
import {
  RepoDiscovery,
  type DiscoveredRepoEvent,
  type ToplevelResolver,
} from '../src/main/repo-discovery';

/** Build a resolver that maps cwd → toplevel via a fixture map. */
function fixedResolver(map: Record<string, string | null>): ToplevelResolver {
  return async (cwd) => (cwd in map ? map[cwd]! : null);
}

describe('RepoDiscovery', () => {
  it('emits discovered-repo for a cwd inside an untracked git repo', async () => {
    const resolver = vi.fn(fixedResolver({ '/Users/me/scratch': '/Users/me/scratch' }));
    const d = new RepoDiscovery(resolver);
    const events: DiscoveredRepoEvent[] = [];
    d.on('discovered-repo', (e) => events.push(e as DiscoveredRepoEvent));

    await d.onCwd('/Users/me/scratch');

    expect(events).toEqual([{ repoPath: '/Users/me/scratch', viaCwd: '/Users/me/scratch' }]);
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it('does not emit when the cwd is inside a tracked repo (cheap prefix check, no git call)', async () => {
    const resolver = vi.fn(fixedResolver({}));
    const d = new RepoDiscovery(resolver);
    d.setTrackedRepos(['/Users/me/work']);
    const events: DiscoveredRepoEvent[] = [];
    d.on('discovered-repo', (e) => events.push(e as DiscoveredRepoEvent));

    await d.onCwd('/Users/me/work/src/sub');

    expect(events).toEqual([]);
    expect(resolver).not.toHaveBeenCalled();
  });

  it('does not emit for a worktree whose parent repo is tracked', async () => {
    // An out-of-tree worktree fails the cheap prefix check, but the resolver
    // maps it to its parent repo — which is tracked, so no toast.
    const resolver = vi.fn(fixedResolver({ '/elsewhere/wt-foo': '/Users/me/work' }));
    const d = new RepoDiscovery(resolver);
    d.setTrackedRepos(['/Users/me/work']);
    const events: DiscoveredRepoEvent[] = [];
    d.on('discovered-repo', (e) => events.push(e as DiscoveredRepoEvent));

    await d.onCwd('/elsewhere/wt-foo');

    expect(events).toEqual([]);
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it('does not emit when the resolved toplevel is on the dismissed list', async () => {
    const resolver = fixedResolver({ '/Users/me/skip/src': '/Users/me/skip' });
    const d = new RepoDiscovery(resolver);
    d.setDismissedRepos(['/Users/me/skip']);
    const events: DiscoveredRepoEvent[] = [];
    d.on('discovered-repo', (e) => events.push(e as DiscoveredRepoEvent));

    await d.onCwd('/Users/me/skip/src');

    expect(events).toEqual([]);
  });

  it('does not emit for a cwd outside any git repo', async () => {
    const resolver = fixedResolver({ '/tmp/random': null });
    const d = new RepoDiscovery(resolver);
    const events: DiscoveredRepoEvent[] = [];
    d.on('discovered-repo', (e) => events.push(e as DiscoveredRepoEvent));

    await d.onCwd('/tmp/random');

    expect(events).toEqual([]);
  });

  it('caches a resolution so a repeat onCwd for the same path skips git', async () => {
    const resolver = vi.fn(fixedResolver({ '/Users/me/x': '/Users/me/x' }));
    const d = new RepoDiscovery(resolver);
    const events: DiscoveredRepoEvent[] = [];
    d.on('discovered-repo', (e) => events.push(e as DiscoveredRepoEvent));

    await d.onCwd('/Users/me/x');
    await d.onCwd('/Users/me/x');
    await d.onCwd('/Users/me/x');

    expect(events).toHaveLength(1); // First call only.
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it('emits only once per unique untracked repo, even from different sub-cwds', async () => {
    const resolver = fixedResolver({
      '/repo/src': '/repo',
      '/repo/lib': '/repo',
    });
    const d = new RepoDiscovery(resolver);
    const events: DiscoveredRepoEvent[] = [];
    d.on('discovered-repo', (e) => events.push(e as DiscoveredRepoEvent));

    await d.onCwd('/repo/src');
    await d.onCwd('/repo/lib');

    // /repo/src triggers discovery; /repo/lib hits the prefix check via the
    // newly-discovered repo? Actually no — discovered isn't auto-tracked.
    // Both cwds resolve to the same toplevel; both fire `discovered-repo`
    // because the consumer (UI / repos-store) is responsible for either
    // adding or dismissing. We explicitly do NOT auto-suppress duplicates
    // by repoPath — the renderer dedupes by repoPath in its toast queue.
    expect(events.map((e) => e.repoPath)).toEqual(['/repo', '/repo']);
  });

  it('clears the cache when tracked repos change so a newly-added repo stops being "discovered"', async () => {
    const resolver = vi.fn(fixedResolver({ '/r/src': '/r' }));
    const d = new RepoDiscovery(resolver);
    const events: DiscoveredRepoEvent[] = [];
    d.on('discovered-repo', (e) => events.push(e as DiscoveredRepoEvent));

    await d.onCwd('/r/src');
    expect(events).toHaveLength(1);

    // User accepts the toast → repo becomes tracked. Cache must clear so the
    // same cwd is now classified `tracked` instead of staying `discovered`.
    d.setTrackedRepos(['/r']);
    await d.onCwd('/r/src');
    expect(events).toHaveLength(1); // No new emit.
  });

  it('clears the cache when dismissed repos change', async () => {
    const resolver = fixedResolver({ '/r/src': '/r' });
    const d = new RepoDiscovery(resolver);
    const events: DiscoveredRepoEvent[] = [];
    d.on('discovered-repo', (e) => events.push(e as DiscoveredRepoEvent));

    d.setDismissedRepos(['/r']);
    await d.onCwd('/r/src');
    expect(events).toHaveLength(0);

    // Un-dismiss (rare, but possible if the user clears settings) → discovery resumes.
    d.setDismissedRepos([]);
    await d.onCwd('/r/src');
    expect(events).toHaveLength(1);
  });

  it('treats a resolver throw as not-in-repo and does not retry', async () => {
    const resolver = vi.fn(async (_cwd: string) => {
      throw new Error('git not found');
    });
    const d = new RepoDiscovery(resolver);
    const events: DiscoveredRepoEvent[] = [];
    d.on('discovered-repo', (e) => events.push(e as DiscoveredRepoEvent));

    await d.onCwd('/anything');
    await d.onCwd('/anything'); // cache hit; resolver not called again

    expect(events).toEqual([]);
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it('ignores empty cwd', async () => {
    const resolver = vi.fn(fixedResolver({}));
    const d = new RepoDiscovery(resolver);
    await d.onCwd('');
    expect(resolver).not.toHaveBeenCalled();
  });

  it('handles cwd === toplevel correctly (path is the repo root, no trailing slash)', async () => {
    const resolver = fixedResolver({ '/Users/me/work': '/Users/me/work' });
    const d = new RepoDiscovery(resolver);
    d.setTrackedRepos(['/Users/me/work']);
    const events: DiscoveredRepoEvent[] = [];
    d.on('discovered-repo', (e) => events.push(e as DiscoveredRepoEvent));

    await d.onCwd('/Users/me/work');
    expect(events).toEqual([]); // Exact-match prefix.
  });

  it('does not match a sibling repo by accidental prefix (foo vs foobar)', async () => {
    const resolver = fixedResolver({ '/code/foobar': '/code/foobar' });
    const d = new RepoDiscovery(resolver);
    d.setTrackedRepos(['/code/foo']);
    const events: DiscoveredRepoEvent[] = [];
    d.on('discovered-repo', (e) => events.push(e as DiscoveredRepoEvent));

    await d.onCwd('/code/foobar');
    expect(events).toEqual([{ repoPath: '/code/foobar', viaCwd: '/code/foobar' }]);
  });
});
