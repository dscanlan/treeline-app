import { useEffect, useRef } from 'react';
import type { PaneLeaf } from '@shared/pane-tree';
import { useXterm } from '../hooks/useXterm';
import { useStore } from '../store';
import { TabStatusDot } from './TabStatusDot';

interface Props {
  leaf: PaneLeaf;
  tabId: string;
  /** True if this leaf is the focused pane of an active, visible tab. */
  active: boolean;
  /** True if more than one pane exists in the tab (show focus chrome). */
  showChrome: boolean;
}

/**
 * One mounted xterm instance per pane (leaf). Like the old TerminalView, the
 * instance stays mounted while its tab is hidden so it keeps consuming PTY data
 * — the "hidden tabs stay mounted" rule now applies *per leaf*. Clicking the
 * pane focuses it within the tab; the focused pane gets a ring + autofocus.
 */
export function PaneView({ leaf, tabId, active, showChrome }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const handle = useXterm(containerRef, { ptyId: leaf.ptyId, cwd: leaf.cwd });
  const setFocusedPane = useStore((s) => s.setFocusedPane);

  // When this pane becomes the active focused pane, its container may have just
  // been revealed or resized: refit and pull keyboard focus into the terminal.
  useEffect(() => {
    if (active)
      requestAnimationFrame(() => {
        handle.refit();
        handle.focus();
      });
  }, [active, handle]);

  return (
    <div
      className="relative h-full w-full overflow-hidden bg-treeline-surface"
      onPointerDown={() => setFocusedPane(tabId, leaf.id)}
    >
      <div ref={containerRef} className="absolute inset-0" />
      {showChrome && (
        <>
          {/* Focus ring — only on the focused pane of a multi-pane tab. */}
          {active && (
            <div className="pointer-events-none absolute inset-0 z-10 ring-1 ring-inset ring-treeline-cyan/60" />
          )}
          {/* Per-pane badge: status dot + title (e.g. process / cwd basename). */}
          <div className="pointer-events-none absolute right-1 top-1 z-10 flex items-center gap-1 rounded bg-treeline-surface/80 px-1.5 py-0.5 text-[10px] text-treeline-dim">
            <TabStatusDot status={leaf.status} />
            <span className="max-w-[140px] truncate">
              {leaf.foregroundCmd ?? leaf.title}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
