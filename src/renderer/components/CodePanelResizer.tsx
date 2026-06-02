import { useStore } from '../store';

/**
 * Draggable divider between the terminal area and the code panel. The panel
 * lives on the right, so dragging left widens it. Width changes flow through the
 * editor slice (clamped there); the terminal's own ResizeObserver picks up the
 * width change and refits xterm, so nothing extra is wired here.
 */
export function CodePanelResizer() {
  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = useStore.getState().codePanelWidth;
    const setWidth = useStore.getState().setCodePanelWidth;

    const onMove = (ev: PointerEvent) => setWidth(startWidth + (startX - ev.clientX));
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
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
