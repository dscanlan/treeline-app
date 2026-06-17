import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import {
  DEFAULT_TERMINAL_FONT_FAMILY,
  DEFAULT_TERMINAL_FONT_SIZE,
  themeForId,
} from '@shared/terminal-theme';
import { useStore } from '../store';

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

  // Terminal theming/font come from the settings store. Read the persisted
  // values; the second effect below live-applies changes without respawning
  // the PTY. The initial read seeds the Terminal so the very first paint is
  // already themed (no flash of default).
  const settings = useStore((s) => s.settings);
  const termRef = useRef<Terminal | null>(null);
  const refitRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      theme: themeForId(settings.terminalTheme),
      fontFamily: settings.fontFamily || DEFAULT_TERMINAL_FONT_FAMILY,
      fontSize: settings.fontSize || DEFAULT_TERMINAL_FONT_SIZE,
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
    // Expose the live term + its refit to the settings effect below so it can
    // re-apply theme/font without tearing down the PTY connection.
    termRef.current = term;
    refitRef.current = doFit;

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
      termRef.current = null;
      ro.disconnect();
      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
      offData();
      offExit();
      dataDispose.dispose();
      term.dispose();
    };
    // Mount effect is keyed only on ptyId so changing theme/font does NOT
    // respawn the PTY. Settings are seeded once here and live-applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.ptyId]);

  // Live-apply terminal theme/font when the settings store changes. Mutating
  // `term.options` re-renders the existing terminal in place; a refit follows
  // because a font-size change alters the cell grid (cols/rows).
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.theme = themeForId(settings.terminalTheme);
    term.options.fontFamily = settings.fontFamily || DEFAULT_TERMINAL_FONT_FAMILY;
    term.options.fontSize = settings.fontSize || DEFAULT_TERMINAL_FONT_SIZE;
    refitRef.current();
  }, [settings.terminalTheme, settings.fontFamily, settings.fontSize]);

  return handleRef.current;
}
