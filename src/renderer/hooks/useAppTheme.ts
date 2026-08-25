import { useEffect } from 'react';
import { useStore } from '../store';
import {
  APP_PALETTE_SLOTS,
  appPaletteForId,
  colorSchemeForId,
  DEFAULT_TERMINAL_FONT_FAMILY,
} from '@shared/terminal-theme';

/**
 * Applies the Settings appearance (theme palette + font) to the document root.
 *
 * The Tailwind `treeline-*` color tokens and the `mono` font token resolve to
 * CSS variables (tailwind.config.ts); globals.css seeds them with the Graphite
 * / default font so the first paint is on-theme. This hook then keeps `:root`
 * in sync with the persisted settings — one Appearance setting drives both the
 * terminal panes (xterm ITheme/font, applied per-pane in useXterm) and the whole
 * app chrome (which inherits `font-mono` + the color tokens). Setting the vars
 * on the live `<html>` element repaints/reflows everything instantly, no reload.
 *
 * Mount once, near the app root.
 */
export function useAppTheme(): void {
  const themeId = useStore((s) => s.settings.terminalTheme);
  const fontFamily = useStore((s) => s.settings.fontFamily);

  useEffect(() => {
    const palette = appPaletteForId(themeId);
    const root = document.documentElement;
    for (const slot of APP_PALETTE_SLOTS) {
      root.style.setProperty(`--treeline-${slot}`, palette[slot]);
    }
    const scheme = colorSchemeForId(themeId);
    root.style.colorScheme = scheme;
    root.dataset.colorScheme = scheme;
  }, [themeId]);

  useEffect(() => {
    document.documentElement.style.setProperty(
      '--treeline-font-mono',
      fontFamily || DEFAULT_TERMINAL_FONT_FAMILY,
    );
  }, [fontFamily]);
}
