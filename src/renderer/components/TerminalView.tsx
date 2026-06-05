import { useEffect, useRef } from 'react';
import { useXterm } from '../hooks/useXterm';

interface Props {
  ptyId: string;
  cwd: string;
  active: boolean;
}

/**
 * One mounted xterm instance per tab. Inactive tabs stay mounted but visually
 * hidden so they keep consuming PTY data into their scrollback (avoids replay
 * on switch). Active tabs trigger a refit so they fill the new viewport.
 */
export function TerminalView({ ptyId, cwd, active }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const handle = useXterm(containerRef, { ptyId, cwd });

  // When this tab becomes active, the container's size may have just changed
  // (was display:none equivalent). Force a refit on the next frame and pull
  // keyboard focus into the terminal so the user can type without an extra
  // click into the viewport.
  useEffect(() => {
    if (active)
      requestAnimationFrame(() => {
        handle.refit();
        handle.focus();
      });
  }, [active, handle]);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 bg-treeline-surface"
      style={{
        visibility: active ? 'visible' : 'hidden',
        pointerEvents: active ? 'auto' : 'none',
      }}
    />
  );
}
