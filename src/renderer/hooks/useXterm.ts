import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

// Graphite (dark) — must match tailwind.config.ts. Traditional dark-terminal
// ANSI convention (ANSI 0=darkest, 7=lightest). `cyan` here is a true cyan
// (`#22d3ee`, Tailwind cyan-400) rather than the chrome blue, so programs
// that print cyan (npm, ls -G dirs) still look right; the chrome blue lives
// in the `blue` slot. Magenta is the muted violet `#b59cf5` to keep the
// single cool-accent discipline of the chrome.
const xtermTheme = {
  background: '#0e0f12',           // surface
  foreground: '#e6e8ee',           // text
  cursor: '#e6e8ee',
  cursorAccent: '#0e0f12',
  selectionBackground: '#2a2d36',  // one step above highlight, visible
  black: '#0e0f12',                // surface (matches bg)
  red: '#f87171',                  // Tailwind red-400
  green: '#4ade80',                // Tailwind green-400
  yellow: '#facc15',               // Tailwind yellow-400
  blue: '#7aa2f7',                 // Tokyo Night blue (chrome accent)
  magenta: '#b59cf5',              // muted violet
  cyan: '#22d3ee',                 // Tailwind cyan-400 — true cyan
  white: '#e6e8ee',                // text
  brightBlack: '#7a7f8c',          // dim — for comments etc.
  brightRed: '#fca5a5',
  brightGreen: '#86efac',
  brightYellow: '#fde047',
  brightBlue: '#93c5fd',
  brightMagenta: '#c4b5fd',
  brightCyan: '#67e8f9',
  brightWhite: '#fafafc',
} as const;

export interface XtermHandle {
  /** Force a re-fit + PTY resize. Call after parent visibility changes. */
  refit: () => void;
  /** Move keyboard focus into the terminal. Call when its tab becomes active. */
  focus: () => void;
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
  const handleRef = useRef<XtermHandle>({
    refit: () => undefined,
    focus: () => undefined,
  });

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
    handleRef.current.focus = () => {
      if (!disposed) term.focus();
    };

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
