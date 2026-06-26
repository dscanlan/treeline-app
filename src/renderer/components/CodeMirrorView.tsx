import { useEffect, useMemo, useRef } from 'react';
import CodeMirror, {
  EditorSelection,
  EditorView,
  Prec,
  keymap,
  type Extension,
  type ReactCodeMirrorRef,
} from '@uiw/react-codemirror';
import { loadLanguage, type LanguageName } from '@uiw/codemirror-extensions-langs';
import { graphiteCodeMirrorTheme } from './codemirror-theme';

/**
 * Map a file extension to a CodeMirror language. Unknown extensions (and
 * extensionless / dotfiles like `.env`) fall through to plain text — which is
 * exactly right for `.env`, the motivating use case.
 */
const EXT_TO_LANG: Record<string, LanguageName> = {
  ts: 'ts',
  tsx: 'tsx',
  js: 'js',
  jsx: 'jsx',
  mjs: 'js',
  cjs: 'js',
  json: 'json',
  jsonc: 'json',
  css: 'css',
  scss: 'sass',
  sass: 'sass',
  less: 'less',
  html: 'html',
  htm: 'html',
  vue: 'vue',
  svelte: 'svelte',
  xml: 'xml',
  svg: 'xml',
  md: 'markdown',
  markdown: 'markdown',
  mdx: 'markdown',
  py: 'python',
  rs: 'rs',
  go: 'go',
  rb: 'rb',
  php: 'php',
  java: 'java',
  kt: 'kt',
  kts: 'kts',
  swift: 'swift',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  cs: 'cs',
  sh: 'sh',
  bash: 'bash',
  zsh: 'bash',
  fish: 'bash',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  sql: 'sql',
};

function languageExtensionFor(filename: string): Extension | null {
  const dot = filename.lastIndexOf('.');
  // No dot, or a leading-dot dotfile with no further extension (".env") → plain.
  if (dot <= 0) return null;
  const ext = filename.slice(dot + 1).toLowerCase();
  const lang = EXT_TO_LANG[ext];
  return lang ? loadLanguage(lang) : null;
}

interface Props {
  value: string;
  /** Basename of the open file; drives language selection. */
  filename: string;
  /** When true, the view is editable (defaults to read-only). */
  editable?: boolean;
  /** Called with the new text on every edit (only fires when editable). */
  onChange?: (value: string) => void;
  /** Called when the user presses ⌘S / Ctrl-S inside the editor. */
  onSave?: () => void;
  /** 1-based line to scroll to + select (from a search hit); null = none. */
  revealLine?: number | null;
  /** Bumps on each reveal request so re-selecting the same line re-scrolls. */
  revealTick?: number;
}

/** Syntax-highlighted CodeMirror view, read-only by default, editable on demand. */
export function CodeMirrorView({
  value,
  filename,
  editable = false,
  onChange,
  onSave,
  revealLine = null,
  revealTick = 0,
}: Props) {
  const cmRef = useRef<ReactCodeMirrorRef>(null);

  // Scroll to + select the target line when a search hit is opened. Keyed on
  // revealTick so the same line re-reveals, and on `value` so it re-fires once
  // the file text has actually loaded (the reveal is requested before the read
  // resolves). A rAF lets CodeMirror finish its layout before we measure.
  useEffect(() => {
    if (revealLine === null) return;
    const view = cmRef.current?.view;
    if (!view) return;
    const raf = requestAnimationFrame(() => {
      const total = view.state.doc.lines;
      const lineNo = Math.min(Math.max(revealLine, 1), total);
      const line = view.state.doc.line(lineNo);
      view.dispatch({
        selection: EditorSelection.range(line.from, line.to),
        effects: EditorView.scrollIntoView(line.from, { y: 'center' }),
      });
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealTick, value]);

  const extensions = useMemo(() => {
    const exts: Extension[] = [...graphiteCodeMirrorTheme, EditorView.lineWrapping];
    const lang = languageExtensionFor(filename);
    if (lang) exts.push(lang);
    // Intercept ⌘S/Ctrl-S so it saves the file instead of doing nothing.
    // Highest precedence so it wins over any default binding.
    exts.push(
      Prec.highest(
        keymap.of([
          {
            key: 'Mod-s',
            run: () => {
              onSave?.();
              return true;
            },
          },
        ]),
      ),
    );
    return exts;
    // onSave is stable enough (module-level action); excluding it keeps the
    // editor from rebuilding extensions on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filename]);

  return (
    <CodeMirror
      ref={cmRef}
      value={value}
      height="100%"
      theme="none"
      extensions={extensions}
      editable={editable}
      onChange={onChange}
      basicSetup={{
        lineNumbers: true,
        foldGutter: true,
        highlightActiveLine: editable,
        highlightActiveLineGutter: editable,
        autocompletion: false,
        closeBrackets: editable,
      }}
      style={{ height: '100%', fontSize: '13px' }}
    />
  );
}
