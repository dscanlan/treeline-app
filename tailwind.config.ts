import type { Config } from 'tailwindcss';

// Treeline palette mirrored from /Users/dominicscanlan/code/treeline/src/ui.rs:14-22
export default {
  content: ['./src/renderer/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      colors: {
        treeline: {
          green: '#7ed385',
          cyan: '#8ddceb',
          magenta: '#c6a0f6',
          yellow: '#eed49f',
          red: '#ed8796',
          dim: '#6e738d',
          surface: '#242742',
          highlight: '#313244',
          text: '#cad3f5',
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
