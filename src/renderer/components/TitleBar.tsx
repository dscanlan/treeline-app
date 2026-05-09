import { SidebarToggle } from './SidebarToggle';

/**
 * Custom titlebar that replaces the OS one (we use `titleBarStyle: 'hiddenInset'`).
 * The whole strip is a drag region except for the toggle button. The 78px
 * left gutter clears the macOS traffic-light buttons.
 */
export function TitleBar() {
  return (
    <div className="drag flex h-9 shrink-0 items-center border-b border-treeline-highlight bg-treeline-surface select-none">
      {/* Traffic-light gap. macOS traffic lights are positioned by the OS at
        * about (18, 13) with a ~52px run, so 78px gives a comfortable margin. */}
      <div className="w-[78px] shrink-0" aria-hidden />
      <span className="text-sm font-semibold text-treeline-cyan">treeline</span>
      <div className="ml-auto flex items-center pr-1">
        <SidebarToggle />
      </div>
    </div>
  );
}
