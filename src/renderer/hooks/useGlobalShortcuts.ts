import { useEffect } from 'react';
import { focusNeighbour, type FocusDir } from '@shared/pane-tree';
import { useStore } from '../store';
import { closeFocusedPane, splitFocusedPane } from '../actions/tabs';

/**
 * Window-level keyboard shortcuts for split panes:
 *
 * - `⌘D`         — split the focused pane to the **right**.
 * - `⌘⇧D`        — split the focused pane **down**.
 * - `⌘⌥←/→/↑/↓`  — move focus to the neighbouring pane in that direction.
 * - `⌘⇧W`        — close the focused pane (collapses the split / closes the tab).
 *
 * Directional focus is gated on `⌥` (Option/Alt) so the bare arrow keys still
 * reach the terminal. We capture at the document level (capture phase) so xterm
 * doesn't swallow the chord first; xterm's own keydown handler runs in the
 * bubble phase on its container.
 */
export function useGlobalShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Only act when a tab is active (otherwise there's nothing to split).
      const hasActive = useStore.getState().activeTabId !== null;
      if (!hasActive) return;
      if (!e.metaKey) return;

      const key = e.key.toLowerCase();

      // Split: ⌘D (right) / ⌘⇧D (down). Guard against ⌥ so it doesn't collide
      // with the directional binding's modifier set.
      if (key === 'd' && !e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        void splitFocusedPane(e.shiftKey ? 'v' : 'h');
        return;
      }

      // Close focused pane: ⌘⇧W (⌘W stays free for any future close-tab).
      if (key === 'w' && e.shiftKey && !e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        void closeFocusedPane();
        return;
      }

      // Directional focus: ⌘⌥ + arrow.
      if (e.altKey) {
        const dir = arrowToDir(e.key);
        if (!dir) return;
        e.preventDefault();
        e.stopPropagation();
        moveFocus(dir);
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, []);
}

function arrowToDir(key: string): FocusDir | null {
  switch (key) {
    case 'ArrowLeft':
      return 'left';
    case 'ArrowRight':
      return 'right';
    case 'ArrowUp':
      return 'up';
    case 'ArrowDown':
      return 'down';
    default:
      return null;
  }
}

function moveFocus(dir: FocusDir): void {
  const s = useStore.getState();
  const tab = s.tabs.find((t) => t.id === s.activeTabId);
  if (!tab) return;
  const next = focusNeighbour(tab.root, tab.focusedPaneId, dir);
  if (next !== tab.focusedPaneId) s.setFocusedPane(tab.id, next);
}
