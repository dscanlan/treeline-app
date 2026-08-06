import { describe, expect, it } from 'vitest';
import {
  setSidebarRepoDisclosure,
  sidebarLocationIsOpen,
  sidebarRepoIsOpen,
  toggleSidebarLocation,
} from '../src/shared/sidebar-disclosure';

describe('sidebar disclosure state', () => {
  it('keeps a collapsed parent collapsed when the catalog is viewed again', () => {
    const parent = '/Users/example/code';
    const collapsed = toggleSidebarLocation([], parent);

    // Opening Files unmounts the catalog, but the stored path remains the
    // source of truth when LocationGroup mounts again after Back.
    expect(sidebarLocationIsOpen(collapsed, parent)).toBe(false);
    expect(sidebarLocationIsOpen(collapsed, '/Users/example/work')).toBe(true);
  });

  it('toggles parent locations independently', () => {
    const first = '/Users/example/code';
    const second = '/Volumes/work';
    let collapsed = toggleSidebarLocation([], first);
    collapsed = toggleSidebarLocation(collapsed, second);

    expect(sidebarLocationIsOpen(collapsed, first)).toBe(false);
    expect(sidebarLocationIsOpen(collapsed, second)).toBe(false);

    collapsed = toggleSidebarLocation(collapsed, first);
    expect(sidebarLocationIsOpen(collapsed, first)).toBe(true);
    expect(sidebarLocationIsOpen(collapsed, second)).toBe(false);
  });

  it('retains repo disclosure separately for Working and Library remounts', () => {
    const repo = '/Users/example/code/treeline-app';
    let repoOpen: Record<string, boolean> = {};

    // Preserve the existing defaults before the user makes a choice.
    expect(sidebarRepoIsOpen(repoOpen, 'working', repo)).toBe(true);
    expect(sidebarRepoIsOpen(repoOpen, 'library', repo)).toBe(false);

    repoOpen = setSidebarRepoDisclosure(repoOpen, 'working', repo, false);
    repoOpen = setSidebarRepoDisclosure(repoOpen, 'library', repo, true);

    // Mode changes, search, and Files navigation may remount RepoNode; its
    // controlled value still comes back from these stable mode/path keys.
    expect(sidebarRepoIsOpen(repoOpen, 'working', repo)).toBe(false);
    expect(sidebarRepoIsOpen(repoOpen, 'library', repo)).toBe(true);
  });

  it('does not mutate prior disclosure snapshots', () => {
    const beforeLocations = ['/Users/example/code'];
    const afterLocations = toggleSidebarLocation(beforeLocations, '/Volumes/work');
    expect(beforeLocations).toEqual(['/Users/example/code']);
    expect(afterLocations).toEqual(['/Users/example/code', '/Volumes/work']);

    const beforeRepos = { 'library:/Users/example/code/api': true };
    const afterRepos = setSidebarRepoDisclosure(
      beforeRepos,
      'library',
      '/Users/example/code/web',
      true,
    );
    expect(beforeRepos).toEqual({ 'library:/Users/example/code/api': true });
    expect(afterRepos).toEqual({
      'library:/Users/example/code/api': true,
      'library:/Users/example/code/web': true,
    });
  });
});
