import { useStore } from '../store';
import { SIDEBAR_DEFAULT_WIDTH } from '../store/repos-slice';

/**
 * Draggable divider on the sidebar's right edge. The sidebar lives on the
 * left, so dragging right widens it. Width changes flow through the repos
 * slice (clamped there). Hidden while the sidebar is collapsed — the toggle
 * is the only way back from width 0.
 */
export function SidebarResizer() {
  const collapsed = useStore((s) => s.sidebarCollapsed);

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = useStore.getState().sidebarWidth;
    const { setSidebarWidth, setSidebarResizing } = useStore.getState();
    setSidebarResizing(true);

    const onMove = (ev: PointerEvent) => setSidebarWidth(startWidth + (ev.clientX - startX));
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setSidebarResizing(false);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  if (collapsed) return null;

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      onPointerDown={onPointerDown}
      onDoubleClick={() => useStore.getState().setSidebarWidth(SIDEBAR_DEFAULT_WIDTH)}
      className="w-px shrink-0 cursor-col-resize bg-treeline-border transition-[width,background-color] hover:w-1 hover:bg-treeline-cyan/40"
    />
  );
}
