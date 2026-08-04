import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { leaves } from '@shared/pane-tree';
import { useStore } from '../store';
import { buildSidebarModel, type SidebarRepoModel } from '@shared/sidebar-model';
import { RepoNode } from './RepoNode';
import { FolderNode } from './FolderNode';
import { FilterInput } from './FilterInput';
import { AddRepoButton } from './AddRepoButton';
import { NewRepoButton } from './NewRepoButton';
import { ScratchList } from './ScratchList';
import { ScratchTerminalButton } from './ScratchTerminalButton';
import { SidebarToggle } from './SidebarToggle';
import { SidebarFiles } from './SidebarFiles';

export function Sidebar() {
  const state = useStore(
    useShallow((s) => ({
      repos: s.repos,
      folders: s.folders,
      worktreesByRepo: s.worktreesByRepo,
      prByRepoBranch: s.prByRepoBranch,
      tabs: s.tabs,
      tabsByCwd: s.tabsByCwd,
      unreadByPtyId: s.unreadByPtyId,
      processesByWorktreePath: s.processesByWorktreePath,
      filter: s.filter,
      sidebarMode: s.sidebarMode,
      sidebarPins: s.sidebarPins,
      sidebarFileRoot: s.sidebarFileRoot,
      sidebarAttentionOnly: s.sidebarAttentionOnly,
      sidebarCollapsed: s.sidebarCollapsed,
      sidebarWidth: s.sidebarWidth,
      sidebarResizing: s.sidebarResizing,
      hasScratches: s.scratches.length > 0,
    })),
  );

  const model = useMemo(() => {
    const unreadCwds = new Set(
      state.tabs
        .filter((tab) => leaves(tab.root).some((leaf) => state.unreadByPtyId[leaf.ptyId]))
        .map((tab) => tab.cwd),
    );
    return buildSidebarModel({
      repos: state.repos,
      folders: state.folders,
      worktreesByRepo: state.worktreesByRepo,
      prByRepoBranch: state.prByRepoBranch,
      tabsByCwd: state.tabsByCwd,
      tabOrder: state.tabs.map((tab) => tab.cwd),
      processesByWorktreePath: state.processesByWorktreePath,
      unreadCwds,
      pinnedPaths: new Set(state.sidebarPins),
      mode: state.sidebarMode,
      query: state.filter,
      attentionOnly: state.sidebarAttentionOnly,
    });
  }, [state]);

  return (
    <aside
      className={`flex h-full shrink-0 flex-col bg-treeline-surface text-sm ${
        state.sidebarResizing ? '' : 'transition-[width] duration-150 ease-out'
      }`}
      style={{ width: state.sidebarCollapsed ? 0 : state.sidebarWidth, overflow: 'hidden' }}
      aria-hidden={state.sidebarCollapsed}
    >
      <div className="flex shrink-0 items-center justify-end px-2 pt-1.5">
        <SidebarToggle />
      </div>

      {state.sidebarFileRoot ? (
        <SidebarFiles root={state.sidebarFileRoot} />
      ) : (
        <>
          <div className="flex shrink-0 flex-col gap-2 px-3 pt-1 pb-2">
            <FilterInput />
            <div className="flex items-center gap-1">
              <ModeButton
                label="Working"
                count={model.workingCount}
                active={state.sidebarMode === 'working'}
                onClick={() => useStore.getState().setSidebarMode('working')}
              />
              <ModeButton
                label="Library"
                count={model.libraryCount}
                active={state.sidebarMode === 'library'}
                onClick={() => useStore.getState().setSidebarMode('library')}
              />
              <button
                type="button"
                onClick={() =>
                  useStore.getState().setSidebarAttentionOnly(!state.sidebarAttentionOnly)
                }
                title="Show worktrees needing attention"
                aria-label="Show worktrees needing attention"
                aria-pressed={state.sidebarAttentionOnly}
                className={`ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded border ${
                  state.sidebarAttentionOnly
                    ? 'border-treeline-yellow bg-treeline-yellow/10 text-treeline-yellow'
                    : 'border-treeline-highlight text-treeline-dim hover:bg-treeline-highlight hover:text-treeline-text'
                }`}
              >
                !
              </button>
            </div>
            {state.sidebarMode === 'library' ? (
              <div className="flex gap-1 text-xs">
                <AddRepoButton />
                <NewRepoButton />
                <ScratchTerminalButton />
              </div>
            ) : (
              <div className="flex text-xs">
                <ScratchTerminalButton />
              </div>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto pb-2">
            {state.sidebarMode === 'working' && !model.searching && state.hasScratches && (
              <>
                <ScratchList />
                <hr className="my-2 border-treeline-highlight" />
              </>
            )}
            <SidebarContents model={model} mode={state.sidebarMode} />
          </div>
        </>
      )}
    </aside>
  );
}

function ModeButton({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex h-7 min-w-0 flex-1 items-center justify-center gap-1 rounded border px-2 text-xs ${
        active
          ? 'border-treeline-cyan/60 bg-treeline-highlight text-treeline-text'
          : 'border-treeline-highlight text-treeline-dim hover:bg-treeline-highlight hover:text-treeline-text'
      }`}
    >
      <span className="truncate">{label}</span>
      <span className="text-[10px] text-treeline-dim">{count}</span>
    </button>
  );
}

function SidebarContents({
  model,
  mode,
}: {
  model: ReturnType<typeof buildSidebarModel>;
  mode: 'working' | 'library';
}) {
  const hasResults = model.repos.length > 0 || model.folders.length > 0;
  const attentionOnly = useStore((s) => s.sidebarAttentionOnly);

  if (!hasResults) {
    if (model.searching) return <EmptyText>No matching repositories or worktrees.</EmptyText>;
    if (attentionOnly) return <EmptyText>No worktrees need attention.</EmptyText>;
    if (mode === 'working') {
      return (
        <div className="px-4 py-6 text-treeline-dim">
          <div className="mb-3">No worktrees are open or pinned.</div>
          <button
            type="button"
            onClick={() => useStore.getState().setSidebarMode('library')}
            className="text-treeline-cyan hover:text-treeline-text"
          >
            Browse {model.libraryCount} {model.libraryCount === 1 ? 'item' : 'items'}
          </button>
        </div>
      );
    }
    return <EmptyText>No repositories yet. Use Add repo / folder to begin.</EmptyText>;
  }

  const grouped = groupByParent(model.repos);
  const showLocations = mode === 'library' && grouped.length > 1 && !model.searching;

  return (
    <div className="px-1" data-ss={model.searching ? 'sidebar-search-results' : `sidebar-${mode}`}>
      {model.searching && (
        <div className="px-2 pb-1 text-[10px] uppercase text-treeline-dim">Search results</div>
      )}
      {showLocations
        ? grouped.map(([parent, repos]) => (
            <LocationGroup key={parent} parent={parent} repos={repos} mode={mode} />
          ))
        : model.repos.map((entry) => (
            <RepoEntry
              key={`${mode}:${entry.repo.path}`}
              entry={entry}
              mode={mode}
              forceOpen={model.searching}
            />
          ))}
      {model.folders.length > 0 && (
        <section className="mt-3 border-t border-treeline-highlight pt-2">
          <div className="px-2 pb-1 text-[10px] uppercase text-treeline-dim">Folders</div>
          {model.folders.map((folder) => (
            <FolderNode key={folder.path} folder={folder} />
          ))}
        </section>
      )}
    </div>
  );
}

function RepoEntry({
  entry,
  mode,
  forceOpen = false,
}: {
  entry: SidebarRepoModel;
  mode: 'working' | 'library';
  forceOpen?: boolean;
}) {
  return (
    <RepoNode
      repo={entry.repo}
      worktrees={entry.worktrees}
      defaultOpen={mode === 'working'}
      forceOpen={forceOpen}
      totalWorktrees={entry.totalWorktrees}
      activeWorktrees={entry.activeWorktrees}
      dirtyWorktrees={entry.dirtyWorktrees}
    />
  );
}

function LocationGroup({
  parent,
  repos,
  mode,
}: {
  parent: string;
  repos: SidebarRepoModel[];
  mode: 'working' | 'library';
}) {
  const [open, setOpen] = useState(true);
  const label = parent.split('/').filter(Boolean).pop() ?? parent;
  return (
    <section className="mb-1">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        title={parent}
        className="sticky top-0 z-10 flex w-full items-center gap-1 bg-treeline-surface px-2 py-1 text-left text-[10px] uppercase text-treeline-dim"
      >
        <span>{open ? '▾' : '▸'}</span>
        <span className="truncate">{label}</span>
        <span className="ml-auto">{repos.length}</span>
      </button>
      {open && repos.map((entry) => <RepoEntry key={entry.repo.path} entry={entry} mode={mode} />)}
    </section>
  );
}

function groupByParent(repos: SidebarRepoModel[]): Array<[string, SidebarRepoModel[]]> {
  const grouped = new Map<string, SidebarRepoModel[]>();
  for (const entry of repos) {
    const slash = entry.repo.path.lastIndexOf('/');
    const parent = slash > 0 ? entry.repo.path.slice(0, slash) : '/';
    const list = grouped.get(parent) ?? [];
    list.push(entry);
    grouped.set(parent, list);
  }
  return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function EmptyText({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-6 text-treeline-dim">{children}</div>;
}
