import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../store';
import { RepoNode } from './RepoNode';
import { FilterInput } from './FilterInput';
import { AddRepoButton } from './AddRepoButton';
import { NewRepoButton } from './NewRepoButton';
import { ScratchList } from './ScratchList';
import { ScratchTerminalButton } from './ScratchTerminalButton';
import { SidebarToggle } from './SidebarToggle';

export function Sidebar() {
  const { repos, sidebarCollapsed, sidebarWidth, sidebarResizing, hasScratches } = useStore(
    useShallow((s) => ({
      repos: s.repos,
      sidebarCollapsed: s.sidebarCollapsed,
      sidebarWidth: s.sidebarWidth,
      sidebarResizing: s.sidebarResizing,
      hasScratches: s.scratches.length > 0,
    })),
  );

  return (
    <aside
      // The width transition animates collapse/expand but is dropped during a
      // resize drag so the edge tracks the cursor instead of easing toward it.
      // The right-edge divider is SidebarResizer, not a border here.
      className={`flex h-full shrink-0 flex-col bg-treeline-surface text-sm ${
        sidebarResizing ? '' : 'transition-[width] duration-150 ease-out'
      }`}
      style={{ width: sidebarCollapsed ? 0 : sidebarWidth, overflow: 'hidden' }}
      aria-hidden={sidebarCollapsed}
    >
      {/* Header strip: collapse button lives here so the affordance sits on
        * the sidebar itself. When the sidebar is collapsed (width: 0) this is
        * naturally hidden — the TitleBar's SidebarToggle takes over as the
        * expand affordance in that state. */}
      <div className="flex shrink-0 items-center justify-end px-2 pt-1.5">
        <SidebarToggle />
      </div>
      <div className="flex flex-col gap-2 px-3 pt-1 pb-2">
        <FilterInput />
        {/* Three sibling actions: add an existing repo, create a new repo,
          * open a scratch terminal. Compact row at the cap; a fourth action
          * would tip the balance toward a dropdown. */}
        <div className="flex gap-1 text-xs">
          <AddRepoButton />
          <NewRepoButton />
          <ScratchTerminalButton />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {/* Scratch terminals appear above repos with a divider — ephemeral,
          * auto-numbered "Scratch N" rows. The list component renders nothing
          * when empty, so the divider is only shown when there's content to
          * separate. */}
        {hasScratches && (
          <>
            <ScratchList />
            <hr className="my-2 border-treeline-highlight" />
          </>
        )}
        <div className="px-1">
          {repos.length === 0 ? (
            <div className="px-3 py-6 text-treeline-dim">
              No repositories yet. Click <span className="text-treeline-text">+ Add repo</span> to
              begin.
            </div>
          ) : (
            repos.map((r) => <RepoNode key={r.path} repo={r} />)
          )}
        </div>
      </div>
    </aside>
  );
}
