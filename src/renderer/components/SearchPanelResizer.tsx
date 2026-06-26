import { useStore } from '../store';

/**
 * Draggable divider on the left edge of the find-in-files panel. The panel sits
 * on the right, so dragging left widens it. Width is clamped in the search
 * slice; the terminal's ResizeObserver refits xterm as the layout reflows.
 * Mirrors NotesPanelResizer (pointer capture keeps the drag robust).
 */
export function SearchPanelResizer() {
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);

    const startX = e.clientX;
    const startWidth = useStore.getState().searchPanelWidth;
    const setWidth = useStore.getState().setSearchPanelWidth;

    const onMove = (ev: PointerEvent) => setWidth(startWidth + (startX - ev.clientX));
    const onUp = (ev: PointerEvent) => {
      el.releasePointerCapture(ev.pointerId);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      onPointerDown={onPointerDown}
      className="w-1 shrink-0 cursor-col-resize bg-treeline-highlight transition-colors hover:bg-treeline-cyan/40"
    />
  );
}
