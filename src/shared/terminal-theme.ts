// treeline-native xterm theme presets + font defaults.
//
// The xterm `ITheme` shape is reproduced here (rather than imported from
// `@xterm/xterm`) so this module stays pure and importable by the node tsconfig
// — main persists the chosen preset id in config, the renderer maps the id to
// the actual ITheme it hands xterm. Keeping the presets in `shared/` means the
// id↔theme mapping has one home.
//
// v1 is treeline-native presets only. An "import external terminal config"
// hook (Ghostty/iTerm/Terminal.app) is stubbed via `EXTERNAL_THEME_SOURCES`
// but intentionally not implemented — full parsing is out of scope.

/** Subset of xterm's ITheme we populate. Mirrors `@xterm/xterm`'s ITheme. */
export interface XtermTheme {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

/** Stable id persisted in config. Append new presets; don't rename ids. */
export type TerminalThemeId = 'graphite' | 'graphite-light' | 'midnight';

/**
 * App-chrome palette: the nine `treeline-*` slots that drive the whole UI
 * (sidebar, tabs, panels, badges), mirroring the Tailwind token names. The
 * Tailwind tokens resolve to CSS variables (`var(--treeline-<slot>)`), so a
 * theme switch repaints the entire app by reassigning these at `:root` — see
 * `useAppTheme` and `tailwind.config.ts`.
 */
export interface AppPalette {
  surface: string;
  highlight: string;
  text: string;
  dim: string;
  cyan: string;
  magenta: string;
  green: string;
  yellow: string;
  red: string;
}

/** Ordered list of app-palette slots — drives `:root` var application. */
export const APP_PALETTE_SLOTS: readonly (keyof AppPalette)[] = [
  'surface',
  'highlight',
  'text',
  'dim',
  'cyan',
  'magenta',
  'green',
  'yellow',
  'red',
] as const;

export interface TerminalThemePreset {
  id: TerminalThemeId;
  label: string;
  /** xterm colors for the terminal panes. */
  theme: XtermTheme;
  /** chrome colors for the rest of the app. */
  app: AppPalette;
}

// "Graphite" — the app's default. Lifted verbatim from the previous hard-coded
// `xtermTheme` in useXterm.ts so existing users see no visual change on upgrade.
const GRAPHITE: XtermTheme = {
  background: '#0e0f12',
  foreground: '#e6e8ee',
  cursor: '#e6e8ee',
  cursorAccent: '#0e0f12',
  selectionBackground: '#2a2d36',
  black: '#0e0f12',
  red: '#f87171',
  green: '#4ade80',
  yellow: '#facc15',
  blue: '#7aa2f7',
  magenta: '#b59cf5',
  cyan: '#22d3ee',
  white: '#e6e8ee',
  brightBlack: '#7a7f8c',
  brightRed: '#fca5a5',
  brightGreen: '#86efac',
  brightYellow: '#fde047',
  brightBlue: '#93c5fd',
  brightMagenta: '#c4b5fd',
  brightCyan: '#67e8f9',
  brightWhite: '#fafafc',
};

// A light companion to Graphite for users on bright displays.
const GRAPHITE_LIGHT: XtermTheme = {
  background: '#f6f7f9',
  foreground: '#1c1e24',
  cursor: '#1c1e24',
  cursorAccent: '#f6f7f9',
  selectionBackground: '#d7dbe2',
  black: '#1c1e24',
  red: '#c0392b',
  green: '#2e7d32',
  yellow: '#a16207',
  blue: '#2f5fd0',
  magenta: '#7c3aed',
  cyan: '#0e7490',
  white: '#1c1e24',
  brightBlack: '#7a7f8c',
  brightRed: '#e74c3c',
  brightGreen: '#4ade80',
  brightYellow: '#ca8a04',
  brightBlue: '#3b82f6',
  brightMagenta: '#a78bfa',
  brightCyan: '#0891b2',
  brightWhite: '#0e0f12',
};

// A deeper, cooler blue-black variant with more saturated ANSI colors.
const MIDNIGHT: XtermTheme = {
  background: '#0a0e1a',
  foreground: '#c7d2e0',
  cursor: '#7aa2f7',
  cursorAccent: '#0a0e1a',
  selectionBackground: '#22304d',
  black: '#0a0e1a',
  red: '#ff6b81',
  green: '#7bed9f',
  yellow: '#ffd866',
  blue: '#7aa2f7',
  magenta: '#bd93f9',
  cyan: '#56d3e0',
  white: '#c7d2e0',
  brightBlack: '#5b6478',
  brightRed: '#ff8fa3',
  brightGreen: '#a6f0bb',
  brightYellow: '#ffe49a',
  brightBlue: '#a0bdfa',
  brightMagenta: '#d4b3ff',
  brightCyan: '#88e6ef',
  brightWhite: '#eef2f8',
};

// App-chrome palettes (the nine treeline-* slots). Graphite mirrors the
// previous hard-coded tailwind.config.ts tokens verbatim so the default theme
// is visually unchanged; the light/midnight chrome palettes pair with their
// xterm presets above.
const GRAPHITE_APP: AppPalette = {
  surface: '#0e0f12',
  highlight: '#1c1e24',
  text: '#e6e8ee',
  dim: '#7a7f8c',
  cyan: '#7aa2f7',
  magenta: '#b59cf5',
  green: '#4ade80',
  yellow: '#facc15',
  red: '#f87171',
};

const GRAPHITE_LIGHT_APP: AppPalette = {
  surface: '#f6f7f9',
  highlight: '#e4e7ec',
  text: '#1c1e24',
  dim: '#6b7280',
  cyan: '#2f5fd0',
  magenta: '#7c3aed',
  green: '#2e7d32',
  yellow: '#a16207',
  red: '#c0392b',
};

const MIDNIGHT_APP: AppPalette = {
  surface: '#0a0e1a',
  highlight: '#1b2440',
  text: '#c7d2e0',
  dim: '#5b6478',
  cyan: '#7aa2f7',
  magenta: '#bd93f9',
  green: '#7bed9f',
  yellow: '#ffd866',
  red: '#ff6b81',
};

/** All treeline-native presets, in display order. */
export const TERMINAL_THEME_PRESETS: readonly TerminalThemePreset[] = [
  { id: 'graphite', label: 'Graphite (Dark)', theme: GRAPHITE, app: GRAPHITE_APP },
  {
    id: 'graphite-light',
    label: 'Graphite (Light)',
    theme: GRAPHITE_LIGHT,
    app: GRAPHITE_LIGHT_APP,
  },
  { id: 'midnight', label: 'Midnight', theme: MIDNIGHT, app: MIDNIGHT_APP },
] as const;

/** The factory default theme id. */
export const DEFAULT_TERMINAL_THEME_ID: TerminalThemeId = 'graphite';

/** Default monospace stack — matches the previous useXterm hard-coding. */
export const DEFAULT_TERMINAL_FONT_FAMILY =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace';

export const DEFAULT_TERMINAL_FONT_SIZE = 13;

/** Clamp bounds for the font-size setting (px). */
export const MIN_TERMINAL_FONT_SIZE = 8;
export const MAX_TERMINAL_FONT_SIZE = 32;

/** Resolve a theme id (possibly unknown/legacy) to a concrete XtermTheme. */
export function themeForId(id: string | null | undefined): XtermTheme {
  const found = TERMINAL_THEME_PRESETS.find((p) => p.id === id);
  return (found ?? TERMINAL_THEME_PRESETS[0]!).theme;
}

/** Resolve a theme id (possibly unknown/legacy) to its app-chrome palette. */
export function appPaletteForId(id: string | null | undefined): AppPalette {
  const found = TERMINAL_THEME_PRESETS.find((p) => p.id === id);
  return (found ?? TERMINAL_THEME_PRESETS[0]!).app;
}

/** True when `id` names a known preset. */
export function isKnownThemeId(id: string): id is TerminalThemeId {
  return TERMINAL_THEME_PRESETS.some((p) => p.id === id);
}

/**
 * Stubbed external-config import sources. v1 does NOT parse these — the entries
 * exist so the Settings UI can surface a "coming soon" affordance and so a later
 * wave has a single place to register parsers. Do not wire these to real file
 * reads yet.
 */
export const EXTERNAL_THEME_SOURCES = [
  { id: 'ghostty', label: 'Ghostty (~/.config/ghostty/config)' },
  { id: 'iterm2', label: 'iTerm2 color scheme' },
] as const;
