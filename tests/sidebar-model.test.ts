import { describe, expect, it } from 'vitest';
import type { Folder, Repo, Worktree } from '../src/shared/types';
import { buildSidebarModel, type BuildSidebarModelInput } from '../src/shared/sidebar-model';

const repos: Repo[] = [
  { path: '/code/api', name: 'api', addedAt: 1 },
  { path: '/code/web', name: 'web', addedAt: 2 },
];

function worktree(path: string, branch: string, overrides: Partial<Worktree> = {}): Worktree {
  return {
    path,
    branch,
    commit: 'abc1234',
    isBare: false,
    isDirty: false,
    isCurrent: false,
    isClaude: false,
    merged: false,
    ...overrides,
  };
}

const worktreesByRepo = {
  '/code/api': [worktree('/code/api', 'main'), worktree('/code/api-auth', 'feat/auth')],
  '/code/web': [worktree('/code/web', 'main'), worktree('/code/web-ui', 'feat/sidebar')],
};

function input(overrides: Partial<BuildSidebarModelInput> = {}): BuildSidebarModelInput {
  return {
    repos,
    folders: [],
    worktreesByRepo,
    prByRepoBranch: {},
    tabsByCwd: {},
    tabOrder: [],
    processesByWorktreePath: {},
    unreadCwds: new Set(),
    pinnedPaths: new Set(),
    mode: 'working',
    query: '',
    attentionOnly: false,
    ...overrides,
  };
}

describe('buildSidebarModel', () => {
  it('shows only repos and worktrees with open, running, or pinned work in Working', () => {
    const model = buildSidebarModel(
      input({
        tabsByCwd: { '/code/api-auth': ['tab-auth'] },
        tabOrder: ['/code/api-auth'],
        processesByWorktreePath: { '/code/web': [{}] },
        pinnedPaths: new Set(['/code/web-ui']),
      }),
    );

    expect(model.repos.map((entry) => entry.repo.name)).toEqual(['api', 'web']);
    expect(model.repos[0]?.worktrees.map((wt) => wt.branch)).toEqual(['feat/auth']);
    expect(model.repos[1]?.worktrees.map((wt) => wt.branch)).toEqual(['feat/sidebar', 'main']);
    expect(model.workingCount).toBe(3);
  });

  it('searches the full catalog even while Working is selected', () => {
    const model = buildSidebarModel(input({ query: 'sidebar' }));
    expect(model.searching).toBe(true);
    expect(model.repos).toHaveLength(1);
    expect(model.repos[0]?.repo.name).toBe('web');
    expect(model.repos[0]?.worktrees.map((wt) => wt.branch)).toEqual(['feat/sidebar']);
  });

  it('matches repo names and folder names globally', () => {
    const folders: Folder[] = [{ path: '/notes/design', name: 'design', addedAt: 3 }];
    expect(buildSidebarModel(input({ folders, query: 'api' })).repos[0]?.worktrees).toHaveLength(2);
    expect(buildSidebarModel(input({ folders, query: 'design' })).folders).toEqual(folders);
  });

  it('limits attention view to dirty, merged, unread, or failing worktrees', () => {
    const dirty = worktree('/code/api-dirty', 'fix/dirty', { isDirty: true });
    const model = buildSidebarModel(
      input({
        mode: 'library',
        attentionOnly: true,
        worktreesByRepo: {
          ...worktreesByRepo,
          '/code/api': [...worktreesByRepo['/code/api'], dirty],
        },
        unreadCwds: new Set(['/code/web-ui']),
      }),
    );
    expect(
      model.repos.map((entry) => [entry.repo.name, entry.worktrees.map((wt) => wt.branch)]),
    ).toEqual([
      ['api', ['fix/dirty']],
      ['web', ['feat/sidebar']],
    ]);
  });

  it('keeps empty repositories visible in Library while worktrees load', () => {
    const model = buildSidebarModel(input({ mode: 'library', worktreesByRepo: {} }));
    expect(model.repos.map((entry) => entry.repo.name)).toEqual(['api', 'web']);
  });
});
