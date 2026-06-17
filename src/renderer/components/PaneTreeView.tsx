import { useRef } from 'react';
import type { PaneNode, PaneSplit } from '@shared/pane-tree';
import { useStore } from '../store';
import { PaneView } from './PaneView';

interface Props {
  node: PaneNode;
  tabId: string;
  focusedPaneId: string;
  /** Whether this tab is the active, visible one (drives autofocus/refit). */
  tabActive: boolean;
  /** True once we're below a split — leaves should render their focus chrome. */
  multiPane: boolean;
}

/**
 * Recursively render a tab's pane tree. Splits become flex rows ('h') or
 * columns ('v') with draggable dividers between children (the CodePanelResizer
 * pointer idiom, generalised to arbitrary split positions). Leaves render a
 * mounted xterm via PaneView.
 */
export function PaneTreeView({ node, tabId, focusedPaneId, tabActive, multiPane }: Props) {
  if (node.kind === 'leaf') {
    return (
      <PaneView
        leaf={node}
        tabId={tabId}
        active={tabActive && node.id === focusedPaneId}
        showChrome={multiPane}
      />
    );
  }
  return (
    <SplitView
      node={node}
      tabId={tabId}
      focusedPaneId={focusedPaneId}
      tabActive={tabActive}
    />
  );
}

function SplitView({
  node,
  tabId,
  focusedPaneId,
  tabActive,
}: {
  node: PaneSplit;
  tabId: string;
  focusedPaneId: string;
  tabActive: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const setPaneSizes = useStore((s) => s.setPaneSizes);
  const horizontal = node.direction === 'h';

  // Drag the divider between children `index` and `index+1`. Mirrors
  // CodePanelResizer's window-level pointer capture, but converts the pixel
  // delta into fractional size shifts measured against the split container.
  const beginDrag = (index: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const total = horizontal ? rect.width : rect.height;
    if (total <= 0) return;
    const start = horizontal ? e.clientX : e.clientY;
    const startSizes = [...node.sizes];
    const a = startSizes[index];
    const b = startSizes[index + 1];
    const pair = a + b;
    const MIN = 0.08; // keep both panes usable

    const onMove = (ev: PointerEvent) => {
      const pos = horizontal ? ev.clientX : ev.clientY;
      let frac = (pos - start) / total;
      let na = a + frac;
      na = Math.max(MIN, Math.min(pair - MIN, na));
      const next = [...startSizes];
      next[index] = na;
      next[index + 1] = pair - na;
      setPaneSizes(tabId, node.id, next);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    document.body.style.cursor = horizontal ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
  };

  return (
    <div
      ref={containerRef}
      className={`flex h-full w-full min-h-0 min-w-0 ${horizontal ? 'flex-row' : 'flex-col'}`}
    >
      {node.children.map((child, i) => (
        <div key={getNodeId(child)} style={{ flexBasis: 0, flexGrow: node.sizes[i] }} className="relative min-h-0 min-w-0">
          <PaneTreeView
            node={child}
            tabId={tabId}
            focusedPaneId={focusedPaneId}
            tabActive={tabActive}
            multiPane
          />
          {i < node.children.length - 1 && (
            <div
              role="separator"
              aria-orientation={horizontal ? 'vertical' : 'horizontal'}
              onPointerDown={beginDrag(i)}
              className={
                horizontal
                  ? 'absolute right-0 top-0 z-20 h-full w-1 -mr-0.5 cursor-col-resize bg-treeline-highlight transition-colors hover:bg-treeline-cyan/40'
                  : 'absolute bottom-0 left-0 z-20 h-1 w-full -mb-0.5 cursor-row-resize bg-treeline-highlight transition-colors hover:bg-treeline-cyan/40'
              }
            />
          )}
        </div>
      ))}
    </div>
  );
}

function getNodeId(n: PaneNode): string {
  return n.id;
}
