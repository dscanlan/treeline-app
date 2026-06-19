import { useEffect, useRef, useState } from 'react';
import type { PaneLeaf } from '@shared/pane-tree';
import { useXterm } from '../hooks/useXterm';
import { useStore } from '../store';
import { returnToOriginal } from '../actions/tabs';
import { TabStatusDot } from './TabStatusDot';
import { basename } from '../util/path';

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
  // Agent raised an attention notification on this pane and the human hasn't
  // looked yet — light up a ring (independent of focus chrome, so it shows even
  // in a single-pane tab).
  const unread = useStore((s) => s.unreadByPtyId[leaf.ptyId]);
  // This pane was SIGSTOP-parked because its conversation was resumed in a
  // worktree — show a frozen overlay with a way back.
  const handoff = useStore((s) => s.handoffByOriginPty[leaf.ptyId]);
  const [returning, setReturning] = useState(false);

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
      {/* Parked overlay — this session was frozen (SIGSTOP) because its
        * conversation was resumed in a worktree. Dims the terminal and offers a
        * way back, which thaws this pane and discards the worktree fork. */}
      {handoff && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-treeline-surface/85 backdrop-blur-[1px]">
          <div className="max-w-[80%] text-center text-xs text-treeline-dim">
            <div className="mb-1 text-sm text-treeline-text">Session paused</div>
            Resumed in worktree{' '}
            <span className="text-treeline-cyan">{basename(handoff.worktreeCwd)}</span>. This
            copy is frozen so the two can&apos;t run at once.
          </div>
          <button
            type="button"
            disabled={returning}
            onClick={async (e) => {
              e.stopPropagation();
              setReturning(true);
              try {
                await returnToOriginal(leaf.ptyId);
              } finally {
                setReturning(false);
              }
            }}
            className="rounded border border-treeline-cyan bg-treeline-cyan px-3 py-1 text-xs text-treeline-surface hover:opacity-90 disabled:opacity-50"
          >
            {returning ? 'Returning…' : 'Return to original (discards worktree session)'}
          </button>
        </div>
      )}
      {/* Attention ring — agent on this pane is waiting on the human. Drawn
        * above the focus ring and pulsing so it's noticeable across many panes. */}
      {unread && (
        <>
          <div className="pointer-events-none absolute inset-0 z-20 animate-pulse ring-2 ring-inset ring-treeline-magenta" />
          <div
            className="pointer-events-none absolute bottom-1 left-1 z-20 max-w-[60%] truncate rounded bg-treeline-magenta/90 px-1.5 py-0.5 text-[10px] text-treeline-surface"
            title={unread.text}
          >
            ✦ {unread.text}
          </div>
        </>
      )}
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
