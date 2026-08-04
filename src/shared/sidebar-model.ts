import type { Folder, PrInfo, Repo, Worktree } from '@shared/types';

export interface SidebarRepoModel {
  repo: Repo;
  worktrees: Worktree[];
  totalWorktrees: number;
  activeWorktrees: number;
  dirtyWorktrees: number;
  attentionWorktrees: number;
}

export interface BuildSidebarModelInput {
  repos: Repo[];
  folders: Folder[];
  worktreesByRepo: Record<string, Worktree[]>;
  prByRepoBranch: Record<string, Record<string, PrInfo>>;
  tabsByCwd: Record<string, string[]>;
  tabOrder: string[];
  processesByWorktreePath: Record<string, unknown[]>;
  unreadCwds: Set<string>;
  pinnedPaths: Set<string>;
  mode: 'working' | 'library';
  query: string;
  attentionOnly: boolean;
}

export interface SidebarModel {
  repos: SidebarRepoModel[];
  folders: Folder[];
  workingCount: number;
  libraryCount: number;
  searching: boolean;
}

function hasText(value: string, query: string): boolean {
  return value.toLowerCase().includes(query);
}

function worktreeNeedsAttention(
  wt: Worktree,
  repoPath: string,
  prByRepoBranch: Record<string, Record<string, PrInfo>>,
  unreadCwds: Set<string>,
): boolean {
  const pr = prByRepoBranch[repoPath]?.[wt.branch];
  return wt.isDirty || wt.merged || unreadCwds.has(wt.path) || pr?.checks === 'failing';
}

/**
 * Pure sidebar projection. The catalog remains complete in store; this function
 * derives the small operational list without introducing a second source of truth.
 */
export function buildSidebarModel(input: BuildSidebarModelInput): SidebarModel {
  const query = input.query.trim().toLowerCase();
  const searching = query.length > 0;
  // Search is global: an inactive target remains discoverable from Working.
  const effectiveMode = searching ? 'library' : input.mode;
  const order = new Map(input.tabOrder.map((cwd, i) => [cwd, i]));
  const isActive = (path: string) =>
    (input.tabsByCwd[path]?.length ?? 0) > 0 ||
    (input.processesByWorktreePath[path]?.length ?? 0) > 0 ||
    input.pinnedPaths.has(path);

  const catalogPaths = new Set([
    ...input.folders.map((folder) => folder.path),
    ...Object.values(input.worktreesByRepo).flatMap((worktrees) =>
      worktrees.map((worktree) => worktree.path),
    ),
  ]);
  const workingCount = [...catalogPaths].filter(isActive).length;

  const repos = input.repos
    .map((repo) => {
      const all = input.worktreesByRepo[repo.path] ?? [];
      const repoMatches = searching && (hasText(repo.name, query) || hasText(repo.path, query));
      let worktrees = all.filter((wt) => {
        if (effectiveMode === 'working' && !isActive(wt.path)) return false;
        if (searching && !repoMatches && !hasText(wt.branch, query) && !hasText(wt.path, query)) {
          return false;
        }
        return (
          !input.attentionOnly ||
          worktreeNeedsAttention(wt, repo.path, input.prByRepoBranch, input.unreadCwds)
        );
      });

      worktrees = worktrees.sort((a, b) => {
        const aOrder = order.get(a.path) ?? Number.MAX_SAFE_INTEGER;
        const bOrder = order.get(b.path) ?? Number.MAX_SAFE_INTEGER;
        return aOrder - bOrder || a.branch.localeCompare(b.branch);
      });

      return {
        repo,
        worktrees,
        totalWorktrees: all.length,
        activeWorktrees: all.filter((wt) => isActive(wt.path)).length,
        dirtyWorktrees: all.filter((wt) => wt.isDirty).length,
        attentionWorktrees: all.filter((wt) =>
          worktreeNeedsAttention(wt, repo.path, input.prByRepoBranch, input.unreadCwds),
        ).length,
      };
    })
    .filter(
      (entry) =>
        entry.worktrees.length > 0 ||
        (effectiveMode === 'library' &&
          !input.attentionOnly &&
          (!searching || hasText(entry.repo.name, query) || hasText(entry.repo.path, query))),
    )
    .sort((a, b) => {
      const aOrder = Math.min(...a.worktrees.map((wt) => order.get(wt.path) ?? Infinity));
      const bOrder = Math.min(...b.worktrees.map((wt) => order.get(wt.path) ?? Infinity));
      return aOrder - bOrder || a.repo.name.localeCompare(b.repo.name);
    });

  const folders = input.folders
    .filter((folder) => {
      if (effectiveMode === 'working' && !isActive(folder.path)) return false;
      if (input.attentionOnly) return false;
      return !searching || hasText(folder.name, query) || hasText(folder.path, query);
    })
    .sort((a, b) => {
      const aOrder = order.get(a.path) ?? Number.MAX_SAFE_INTEGER;
      const bOrder = order.get(b.path) ?? Number.MAX_SAFE_INTEGER;
      return aOrder - bOrder || a.name.localeCompare(b.name);
    });

  return {
    repos,
    folders,
    workingCount,
    libraryCount: input.repos.length + input.folders.length,
    searching,
  };
}
