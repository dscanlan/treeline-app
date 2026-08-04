import { useMemo } from 'react';
import { useStore } from '../store';
import { basename } from '../util/path';
import { FileTree } from './FileTree';
import { WorktreeFiles } from './WorktreeFiles';

export function SidebarFiles({ root }: { root: string }) {
  const repos = useStore((s) => s.repos);
  const folders = useStore((s) => s.folders);
  const worktreesByRepo = useStore((s) => s.worktreesByRepo);
  const setRoot = useStore((s) => s.setSidebarFileRoot);

  const owner = useMemo(() => {
    const folder = folders.find((candidate) => candidate.path === root);
    if (folder) return { kind: 'folder' as const, title: folder.name, parent: 'Folder' };
    for (const repo of repos) {
      const worktree = (worktreesByRepo[repo.path] ?? []).find(
        (candidate) => candidate.path === root,
      );
      if (worktree) {
        return {
          kind: 'worktree' as const,
          title: worktree.branch || basename(root),
          parent: repo.name,
        };
      }
    }
    return { kind: 'folder' as const, title: basename(root), parent: 'Files' };
  }, [folders, repos, root, worktreesByRepo]);

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-ss="sidebar-files" data-ss-root={root}>
      <div className="shrink-0 border-b border-treeline-highlight px-2 pb-2">
        <button
          type="button"
          onClick={() => setRoot(null)}
          title="Back to repositories"
          aria-label="Back to repositories"
          className="mb-2 flex h-7 w-7 items-center justify-center rounded text-lg text-treeline-dim hover:bg-treeline-highlight hover:text-treeline-text"
        >
          ‹
        </button>
        <div className="min-w-0 px-1">
          <div className="truncate text-[10px] uppercase text-treeline-dim">{owner.parent}</div>
          <div className="truncate font-medium text-treeline-text" title={root}>
            {owner.title}
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1 py-2">
        {owner.kind === 'worktree' ? (
          <WorktreeFiles worktreePath={root} focused />
        ) : (
          <FileTree dirPath={root} depth={0} />
        )}
      </div>
    </div>
  );
}
