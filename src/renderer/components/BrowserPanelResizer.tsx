import { useStore } from '../store';

/**
 * Draggable divider between the terminal area and the browser pane. The pane
 * lives on the right, so dragging left widens it. Width changes flow through the
 * browser slice (clamped there) and the terminal's ResizeObserver refits xterm.
 *
 * Unlike CodePanelResizer this uses pointer *capture* on the divider: the pane
 * hosts an Electron <webview> (a separate process), and a plain
 * `window.addEventListener('pointermove')` stops firing the moment the cursor
 * crosses into the guest. Capturing the pointer on the divider keeps the drag
 * alive over the webview.
 */
export function BrowserPanelResizer() {
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);

    const startX = e.clientX;
    const startWidth = useStore.getState().browserPanelWidth;
    const setWidth = useStore.getState().setBrowserPanelWidth;

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
