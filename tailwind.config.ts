import type { Config } from 'tailwindcss';

// Graphite — Linear/Vercel-style near-black with a single cool accent
// family. Almost everything is a tinted grey; saturation is reserved for
// status moments only. Cyan and magenta both sit in the blue→violet family
// so chrome (tab indicators, headings, Claude badge) reads as one quiet
// design system rather than two competing accents. Status colors
// (green/yellow/red) are Tailwind's 400 ramp — calm but unambiguous.
//
// Slot names (treeline-{green,cyan,magenta,…}) unchanged so component
// classes don't move.
//
// App-wide theming (Settings): every token resolves to a CSS variable
// (`var(--treeline-<slot>)`). The variables are seeded with the Graphite
// values in src/renderer/styles/globals.css (:root) and reassigned at runtime
// by `useAppTheme` from the selected preset's `app` palette
// (src/shared/terminal-theme.ts). So one theme setting repaints both the
// terminal panes (xterm ITheme) and the whole app chrome.
export default {
  // The agent registry lives outside renderer/ but declares Tailwind colour
  // classes (per-agent `colorClass`) — scan it so they aren't purged.
  content: ['./src/renderer/**/*.{ts,tsx,html}', './src/shared/agents.ts'],
  theme: {
    extend: {
      colors: {
        treeline: {
          green: 'var(--treeline-green)',     // "running" status
          cyan: 'var(--treeline-cyan)',       // chrome / "idle"
          magenta: 'var(--treeline-magenta)', // Claude badge
          yellow: 'var(--treeline-yellow)',   // dirty
          red: 'var(--treeline-red)',         // close / error
          dim: 'var(--treeline-dim)',         // secondary text
          surface: 'var(--treeline-surface)', // base
          highlight: 'var(--treeline-highlight)', // hover / selection / borders
          text: 'var(--treeline-text)',       // primary fg
        },
      },
      fontFamily: {
        // The whole app (<body> carries `font-mono`) renders in this stack.
        // It resolves to a CSS variable seeded in globals.css and overridden at
        // runtime by `useAppTheme` from the user's font setting, so the Settings
        // font applies app-wide, not just to the terminal panes.
        mono: ['var(--treeline-font-mono)'],
      },
    },
  },
  plugins: [],
} satisfies Config;
