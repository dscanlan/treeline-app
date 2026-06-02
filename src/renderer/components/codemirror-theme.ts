// Graphite CodeMirror theme — mirrors the xterm theme in hooks/useXterm.ts and
// tailwind.config.ts so the viewer feels native to the rest of the app. Built
// from CodeMirror primitives (no extra theme package): an EditorView.theme for
// the chrome and a HighlightStyle for syntax tokens.
import { EditorView } from '@uiw/react-codemirror';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

const MONO =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace';

const chrome = EditorView.theme(
  {
    '&': { color: '#e6e8ee', backgroundColor: '#0e0f12', fontSize: '13px' },
    '.cm-content': { fontFamily: MONO, caretColor: '#e6e8ee' },
    '.cm-scroller': { fontFamily: MONO, lineHeight: '1.5' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#e6e8ee' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
      { backgroundColor: '#2a2d36' },
    '.cm-gutters': { backgroundColor: '#0e0f12', color: '#7a7f8c', border: 'none' },
    '.cm-activeLine': { backgroundColor: '#15171c' },
    '.cm-activeLineGutter': { backgroundColor: '#15171c', color: '#e6e8ee' },
    '.cm-foldPlaceholder': {
      backgroundColor: 'transparent',
      border: 'none',
      color: '#7a7f8c',
    },
    '.cm-selectionMatch': { backgroundColor: '#2a2d3680' },
  },
  { dark: true },
);

const highlight = HighlightStyle.define([
  { tag: [t.comment, t.lineComment, t.blockComment], color: '#7a7f8c', fontStyle: 'italic' },
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword], color: '#b59cf5' },
  { tag: [t.string, t.special(t.string), t.regexp], color: '#4ade80' },
  { tag: [t.number, t.bool, t.null, t.atom], color: '#facc15' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#7aa2f7' },
  { tag: [t.variableName, t.propertyName], color: '#e6e8ee' },
  { tag: [t.typeName, t.className, t.namespace, t.definition(t.typeName)], color: '#22d3ee' },
  { tag: [t.operator, t.punctuation, t.bracket, t.separator], color: '#7a7f8c' },
  { tag: [t.tagName], color: '#f87171' },
  { tag: [t.attributeName], color: '#facc15' },
  { tag: [t.heading], color: '#7aa2f7', fontWeight: 'bold' },
  { tag: [t.link, t.url], color: '#22d3ee', textDecoration: 'underline' },
  { tag: [t.invalid], color: '#f87171' },
]);

/** The full theme as a CodeMirror extension array (chrome + syntax colors). */
export const graphiteCodeMirrorTheme = [chrome, syntaxHighlighting(highlight)];
