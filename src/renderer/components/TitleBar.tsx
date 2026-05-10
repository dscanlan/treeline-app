import { useStore } from '../store';
import { SidebarToggle } from './SidebarToggle';

/**
 * Custom titlebar that replaces the OS one (we use `titleBarStyle: 'hiddenInset'`).
 * The whole strip is a drag region except for the toggle button. The 78px
 * left gutter clears the macOS traffic-light buttons.
 *
 * The SidebarToggle is rendered here only when the sidebar is collapsed —
 * the primary collapse/expand affordance lives on the Sidebar itself. When
 * the sidebar is hidden (width: 0) we need a fallback expand button, and the
 * titlebar is the natural home for it.
 */
export function TitleBar() {
  const sidebarCollapsed = useStore((s) => s.sidebarCollapsed);
  return (
    <div className="drag flex h-9 shrink-0 items-center border-b border-treeline-highlight bg-treeline-surface select-none">
      {/* Traffic-light gap. macOS traffic lights are positioned by the OS at
        * about (18, 13) with a ~52px run, so 78px gives a comfortable margin. */}
      <div className="w-[78px] shrink-0" aria-hidden />
      {/* Tree-view glyph from resources/icon.svg — same shape as the app icon
        * but without the squircle background (the title bar already provides
        * its own surface). Theme-tracking via stroke-treeline-cyan /
        * fill-treeline-magenta so a palette swap propagates here automatically.
        * viewBox crops to the glyph's bounds (the icon's full canvas is
        * 0..1024; the visible content lives in roughly 270..750, 240..790). */}
      <svg
        viewBox="270 240 480 550"
        className="h-5 w-auto"
        fill="none"
        strokeWidth={80}
        strokeLinecap="round"
        role="img"
        aria-label="treeline"
      >
        <path d="M 320,288 L 320,720" className="stroke-treeline-cyan" />
        <path d="M 320,400 L 600,400" className="stroke-treeline-cyan" />
        <path d="M 320,560 L 700,560" className="stroke-treeline-cyan" />
        <path d="M 320,720 L 560,720" className="stroke-treeline-cyan" />
        <circle cx={640} cy={720} r={60} className="fill-treeline-magenta" />
      </svg>
      <div className="ml-auto flex items-center pr-1">
        {sidebarCollapsed && <SidebarToggle />}
      </div>
    </div>
  );
}
