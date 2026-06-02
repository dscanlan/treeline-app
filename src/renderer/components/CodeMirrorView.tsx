import { useMemo } from 'react';
import CodeMirror, { EditorView, type Extension } from '@uiw/react-codemirror';
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
}

/** Read-only, syntax-highlighted CodeMirror view themed to match the app. */
export function CodeMirrorView({ value, filename }: Props) {
  const extensions = useMemo(() => {
    const exts: Extension[] = [...graphiteCodeMirrorTheme, EditorView.lineWrapping];
    const lang = languageExtensionFor(filename);
    if (lang) exts.push(lang);
    return exts;
  }, [filename]);

  return (
    <CodeMirror
      value={value}
      height="100%"
      theme="none"
      extensions={extensions}
      editable={false}
      basicSetup={{
        lineNumbers: true,
        foldGutter: true,
        highlightActiveLine: false,
        highlightActiveLineGutter: false,
        // Read-only view: no edit affordances needed.
        autocompletion: false,
        closeBrackets: false,
      }}
      style={{ height: '100%', fontSize: '13px' }}
    />
  );
}
