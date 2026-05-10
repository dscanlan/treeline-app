import { useEffect, useState } from 'react';
import { useStore } from '../store';

/**
 * Renders a tooltip-styled overlay positioned just below the element matched
 * by `forceTooltip.selector`. Mounted in the App tree but inert unless the
 * screenshot harness sets `forceTooltip` via `__screenshot:hydrate`.
 *
 * Why this exists: the HTML `title` attribute renders an OS-level tooltip
 * that lives outside the renderer's bitmap, so `webContents.capturePage()`
 * never sees it. The 18-add-button-tooltip scenario needs a tooltip on the
 * `+ Add repo or worktree` button to be visible, so we draw our own.
 *
 * Production note: production main never sends `forceTooltip` and nothing
 * else sets it, so this component renders null in real usage.
 */
export function ScreenshotForceTooltip() {
  const forceTooltip = useStore((s) => s.forceTooltip);
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (!forceTooltip) {
      setRect(null);
      return;
    }
    const el = document.querySelector(forceTooltip.selector);
    if (!el) {
      setRect(null);
      return;
    }
    setRect(el.getBoundingClientRect());
  }, [forceTooltip]);

  if (!forceTooltip || !rect) return null;

  // Position 6px below the element, centred horizontally over its midpoint.
  const top = Math.round(rect.bottom + 6);
  const left = Math.round(rect.left);
  const maxWidth = 320;

  return (
    <div
      role="tooltip"
      style={{ position: 'fixed', top, left, maxWidth, zIndex: 60 }}
      className="pointer-events-none rounded border border-treeline-highlight bg-treeline-surface px-2 py-1 text-xs text-treeline-text shadow-lg"
    >
      {forceTooltip.text}
    </div>
  );
}
