import { useRef, useState } from 'react';
import { useStore } from '../store';
import { TabItem } from './TabItem';
import { openTabAt } from '../actions/tabs';

const DRAG_THRESHOLD_PX = 4;

export function TabBar() {
  const tabs = useStore((s) => s.tabs);
  const reorderTab = useStore((s) => s.reorderTab);
  const selectedSidebarPath = useStore((s) => s.selectedSidebarPath);

  const stripRef = useRef<HTMLDivElement>(null);
  const [draggingTabId, setDraggingTabId] = useState<string | null>(null);
  // Set true once a gesture crosses the drag threshold; read by TabItem's
  // onClick to suppress the trailing click that fires after a real drag.
  const draggedRef = useRef(false);

  const onPlus = async () => {
    if (!selectedSidebarPath) return;
    await openTabAt(selectedSidebarPath, { forceNew: true });
  };

  // Mirrors SidebarResizer's pointer idiom: don't preventDefault up front so a
  // non-drag stays a click; only engage once the pointer moves past threshold.
  const beginDrag = (id: string, e: React.PointerEvent) => {
    const startX = e.clientX;
    draggedRef.current = false;
    let dragging = false;

    const onMove = (ev: PointerEvent) => {
      if (!dragging) {
        if (Math.abs(ev.clientX - startX) < DRAG_THRESHOLD_PX) return;
        dragging = true;
        draggedRef.current = true;
        setDraggingTabId(id);
        document.body.style.userSelect = 'none';
      }
      // Target index = how many sibling-tab midpoints sit left of the cursor.
      const els = stripRef.current?.querySelectorAll<HTMLElement>('[role="tab"]');
      if (!els) return;
      let target = 0;
      els.forEach((el) => {
        const r = el.getBoundingClientRect();
        if (ev.clientX > r.left + r.width / 2) target += 1;
      });
      reorderTab(id, target);
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.userSelect = '';
      setDraggingTabId(null);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  if (tabs.length === 0 && !selectedSidebarPath) return null;

  return (
    <div
      ref={stripRef}
      className="flex h-9 shrink-0 items-end gap-px overflow-x-auto border-b border-treeline-highlight bg-treeline-surface px-2"
    >
      {tabs.map((tab) => (
        <TabItem
          key={tab.id}
          tab={tab}
          onDragStart={beginDrag}
          isDragging={draggingTabId === tab.id}
          didDrag={() => draggedRef.current}
        />
      ))}
      <button
        type="button"
        onClick={onPlus}
        disabled={!selectedSidebarPath}
        title={
          selectedSidebarPath
            ? `New tab on ${selectedSidebarPath}`
            : 'Select a worktree first'
        }
        className="ml-1 rounded px-2 py-1 text-treeline-dim hover:bg-treeline-highlight hover:text-treeline-text disabled:cursor-not-allowed disabled:opacity-40"
      >
        +
      </button>
    </div>
  );
}
