import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

// Treeline palette — must match tailwind.config.ts.
const xtermTheme = {
  background: '#242742',
  foreground: '#cad3f5',
  cursor: '#cad3f5',
  cursorAccent: '#242742',
  selectionBackground: '#313244',
  black: '#242742',
  red: '#ed8796',
  green: '#7ed385',
  yellow: '#eed49f',
  blue: '#8ddceb',
  magenta: '#c6a0f6',
  cyan: '#8ddceb',
  white: '#cad3f5',
  brightBlack: '#6e738d',
  brightRed: '#ed8796',
  brightGreen: '#7ed385',
  brightYellow: '#eed49f',
  brightBlue: '#8ddceb',
  brightMagenta: '#c6a0f6',
  brightCyan: '#8ddceb',
  brightWhite: '#cad3f5',
} as const;

export interface XtermHandle {
  /** Force a re-fit + PTY resize. Call after parent visibility changes. */
  refit: () => void;
}

interface Options {
  ptyId: string;
  cwd: string;
  initialCols?: number;
  initialRows?: number;
}

/**
 * Mounts a single xterm instance into `containerRef.current`. Spawns a PTY in
 * the main process, pipes data both ways, and disposes everything on unmount.
 */
export function useXterm(
  containerRef: React.RefObject<HTMLDivElement>,
  opts: Options,
): XtermHandle {
  // Keep handle stable so consumers can call `refit()` without re-rendering.
  const handleRef = useRef<XtermHandle>({ refit: () => undefined });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      theme: xtermTheme,
      fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
      fontSize: 13,
      lineHeight: 1.2,
      scrollback: 5000,
      cursorBlink: true,
      allowTransparency: false,
      macOptionIsMeta: true,
      cols: opts.initialCols ?? 80,
      rows: opts.initialRows ?? 24,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());

    term.open(container);

    // First fit: needs to happen after the layout has settled. rAF gives the
    // browser a tick to size the parent before FitAddon measures it.
    let disposed = false;
    let lastCols = term.cols;
    let lastRows = term.rows;

    const doFit = () => {
      if (disposed) return;
      try {
        fit.fit();
      } catch {
        // Container has zero size — skip; the ResizeObserver will retry.
        return;
      }
      if (term.cols !== lastCols || term.rows !== lastRows) {
        lastCols = term.cols;
        lastRows = term.rows;
        window.treeline.pty.resize(opts.ptyId, term.cols, term.rows);
      }
    };
    handleRef.current.refit = doFit;

    requestAnimationFrame(doFit);

    // Resize observer with debounce — fires for the container *and* its parent
    // sidebar collapse animation. Trailing edge is what we want.
    let resizeTimer: number | null = null;
    const ro = new ResizeObserver(() => {
      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        resizeTimer = null;
        doFit();
      }, 50);
    });
    ro.observe(container);

    // PTY → xterm.
    const offData = window.treeline.pty.onData(opts.ptyId, (chunk) => {
      term.write(chunk);
    });

    const offExit = window.treeline.pty.onExit(opts.ptyId, () => {
      term.write('\r\n\x1b[2;90m[process exited]\x1b[0m\r\n');
    });

    // xterm → PTY.
    const dataDispose = term.onData((data) => {
      window.treeline.pty.write(opts.ptyId, data);
    });

    return () => {
      disposed = true;
      ro.disconnect();
      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
      offData();
      offExit();
      dataDispose.dispose();
      term.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.ptyId]);

  return handleRef.current;
}
