import { toggleSidebar } from '../actions/sidebar';
import { useStore } from '../store';

/**
 * Sidebar collapse toggle. Lives in the TitleBar (not absolutely positioned),
 * so it must explicitly opt out of the parent's drag region.
 */
export function SidebarToggle() {
  const collapsed = useStore((s) => s.sidebarCollapsed);

  return (
    <button
      type="button"
      onClick={toggleSidebar}
      title={`${collapsed ? 'Show' : 'Hide'} sidebar (⌘B)`}
      aria-label={`${collapsed ? 'Show' : 'Hide'} sidebar`}
      data-ss="sidebar-toggle"
      className="no-drag rounded px-2 py-0.5 text-treeline-dim hover:bg-treeline-highlight hover:text-treeline-text"
    >
      {collapsed ? '›' : '‹'}
    </button>
  );
}
