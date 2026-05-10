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
export default {
  content: ['./src/renderer/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      colors: {
        treeline: {
          green: '#4ade80',   // Tailwind green-400 — "running" status
          cyan: '#7aa2f7',    // Tokyo Night blue — chrome / "idle"
          magenta: '#b59cf5', // muted violet — Claude badge (intentionally quiet)
          yellow: '#facc15',  // Tailwind yellow-400 — dirty
          red: '#f87171',     // Tailwind red-400 — close / error
          dim: '#7a7f8c',     // cool mid-grey — secondary text
          surface: '#0e0f12', // near-black, not OLED black (Material 3 rule)
          highlight: '#1c1e24', // one Radix step up from surface
          text: '#e6e8ee',    // primary fg, slight cool tint
        },
      },
      fontFamily: {
        mono: [
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Monaco',
          'Consolas',
          'Liberation Mono',
          'monospace',
        ],
      },
    },
  },
  plugins: [],
} satisfies Config;
