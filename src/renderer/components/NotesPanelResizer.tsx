import { useStore } from '../store';

/**
 * Draggable divider between the terminal area and the scratchpad panel. The pane
 * lives on the right, so dragging left widens it. Width changes flow through the
 * notes slice (clamped there) and the terminal's ResizeObserver refits xterm.
 *
 * Unlike BrowserPanelResizer this doesn't need pointer *capture* (the scratchpad
 * is a plain DOM textarea, not a separate-process <webview>), but capturing is
 * harmless and keeps the drag robust, so we mirror the browser resizer.
 */
export function NotesPanelResizer() {
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);

    const startX = e.clientX;
    const startWidth = useStore.getState().notesPanelWidth;
    const setWidth = useStore.getState().setNotesPanelWidth;

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
