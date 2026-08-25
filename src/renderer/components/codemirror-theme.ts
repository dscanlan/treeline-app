// CodeMirror theme derived from the same preset as xterm and the app chrome.
// Keeping this dynamic prevents the editor from becoming a dark island when
// the user switches to Graphite Light.
import { EditorView } from '@uiw/react-codemirror';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { appPaletteForId, colorSchemeForId, themeForId } from '@shared/terminal-theme';

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace';

/** Build editor chrome and syntax colors for the selected terminal preset. */
export function codeMirrorThemeForId(themeId: string) {
  const palette = appPaletteForId(themeId);
  const terminal = themeForId(themeId);
  const dark = colorSchemeForId(themeId) === 'dark';

  const chrome = EditorView.theme(
    {
      '&': {
        color: terminal.foreground,
        backgroundColor: terminal.background,
        fontSize: '13px',
      },
      '.cm-content': { fontFamily: MONO, caretColor: terminal.cursor },
      '.cm-scroller': { fontFamily: MONO, lineHeight: '1.5' },
      '.cm-cursor, .cm-dropCursor': { borderLeftColor: terminal.cursor },
      '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
        backgroundColor: terminal.selectionBackground,
      },
      '.cm-gutters': {
        backgroundColor: palette.panel,
        color: palette.dim,
        borderRight: `1px solid ${palette.border}`,
      },
      '.cm-activeLine': { backgroundColor: palette.highlight },
      '.cm-activeLineGutter': {
        backgroundColor: palette.highlight,
        color: palette.text,
      },
      '.cm-foldPlaceholder': {
        backgroundColor: 'transparent',
        border: 'none',
        color: palette.dim,
      },
      '.cm-selectionMatch': { backgroundColor: terminal.selectionBackground },
    },
    { dark },
  );

  const highlight = HighlightStyle.define([
    {
      tag: [t.comment, t.lineComment, t.blockComment],
      color: palette.dim,
      fontStyle: 'italic',
    },
    {
      tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword],
      color: terminal.magenta,
    },
    { tag: [t.string, t.special(t.string), t.regexp], color: terminal.green },
    { tag: [t.number, t.bool, t.null, t.atom], color: terminal.yellow },
    {
      tag: [t.function(t.variableName), t.function(t.propertyName)],
      color: terminal.blue,
    },
    { tag: [t.variableName, t.propertyName], color: terminal.foreground },
    {
      tag: [t.typeName, t.className, t.namespace, t.definition(t.typeName)],
      color: terminal.cyan,
    },
    { tag: [t.operator, t.punctuation, t.bracket, t.separator], color: palette.dim },
    { tag: [t.tagName], color: terminal.red },
    { tag: [t.attributeName], color: terminal.yellow },
    { tag: [t.heading], color: terminal.blue, fontWeight: 'bold' },
    { tag: [t.link, t.url], color: terminal.cyan, textDecoration: 'underline' },
    { tag: [t.invalid], color: terminal.red },
  ]);

  return [chrome, syntaxHighlighting(highlight)];
}
