import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../store';
import { RepoNode } from './RepoNode';
import { FilterInput } from './FilterInput';
import { AddRepoButton } from './AddRepoButton';

export function Sidebar() {
  const { repos, sidebarCollapsed } = useStore(
    useShallow((s) => ({ repos: s.repos, sidebarCollapsed: s.sidebarCollapsed })),
  );

  return (
    <aside
      className="flex h-full shrink-0 flex-col border-r border-treeline-highlight bg-treeline-surface text-sm transition-[width] duration-150 ease-out"
      style={{ width: sidebarCollapsed ? 0 : 256, overflow: 'hidden' }}
      aria-hidden={sidebarCollapsed}
    >
      <div className="flex flex-col gap-2 px-3 py-2">
        <FilterInput />
        <AddRepoButton />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
        {repos.length === 0 ? (
          <div className="px-3 py-6 text-treeline-dim">
            No repositories yet. Click <span className="text-treeline-text">+ Add repo</span> to
            begin.
          </div>
        ) : (
          repos.map((r) => <RepoNode key={r.path} repo={r} />)
        )}
      </div>
    </aside>
  );
}
