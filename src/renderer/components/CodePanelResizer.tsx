import { useStore } from '../store';
import { clampCodePanelWidth } from '../store/editor-slice';

/**
 * Draggable divider between the terminal area and the code panel. The panel
 * lives on the right, so dragging left widens it. The terminal's own
 * ResizeObserver picks up the width change and refits xterm, so nothing extra
 * is wired here.
 *
 * Both the drag origin and the ceiling are measured from the DOM at
 * pointerdown rather than taken from the store:
 *
 * - The origin is the panel's *rendered* width. Taking the store value let it
 *   drift above what was on screen once a drag hit the ceiling, so dragging
 *   back the other way did nothing until the stale value drained down — a dead
 *   zone hundreds of pixels wide on a large display.
 * - The ceiling is 90% of the space free beside the other open panels, so it
 *   tracks the window and the browser/scratchpad/search panels instead of a
 *   fixed pixel cap. Want more than that? Hide the sidebar — that widens the
 *   workspace this 90% is measured against.
 */
export function CodePanelResizer() {
  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const setWidth = useStore.getState().setCodePanelWidth;

    const resizer = e.currentTarget as HTMLElement;
    const panel = resizer.nextElementSibling as HTMLElement | null;
    const row = resizer.parentElement;
    if (!panel || !row) return;

    const startWidth = panel.getBoundingClientRect().width;
    // Everything in the row that is neither the terminal (which yields space
    // freely) nor this panel: the other panels and their dividers.
    const taken = [...row.children]
      .filter((el) => el !== panel && el !== row.firstElementChild)
      .reduce((sum, el) => sum + el.getBoundingClientRect().width, 0);
    const available = row.getBoundingClientRect().width - taken;

    const onMove = (ev: PointerEvent) =>
      setWidth(clampCodePanelWidth(startWidth + (startX - ev.clientX), available));
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
