import { describe, expect, it } from 'vitest';
import { mermaidSource, mermaidThemeVariables, type HastNode } from '../src/shared/mermaid-block';
import { appPaletteForId } from '../src/shared/terminal-theme';

// Hand-built hast trees matching what react-markdown hands a `pre` override.

function text(value: string): HastNode {
  return { type: 'text', value };
}

function code(className: unknown, ...children: HastNode[]): HastNode {
  return { type: 'element', tagName: 'code', properties: { className }, children };
}

function pre(...children: HastNode[]): HastNode {
  return { type: 'element', tagName: 'pre', properties: {}, children };
}

describe('mermaidSource', () => {
  it('extracts the source from a mermaid fence', () => {
    const node = pre(code(['language-mermaid'], text('graph LR\n  A --> B\n')));
    expect(mermaidSource(node)).toBe('graph LR\n  A --> B');
  });

  it('joins text nodes a highlighter may have split', () => {
    const node = pre(code(['language-mermaid'], text('graph LR\n'), text('  A --> B')));
    expect(mermaidSource(node)).toBe('graph LR\n  A --> B');
  });

  it('accepts a raw class string as well as a parsed list', () => {
    const node = pre(code('language-mermaid hljs', text('graph LR\n  A --> B')));
    expect(mermaidSource(node)).toBe('graph LR\n  A --> B');
  });

  it('returns null for a non-mermaid fence', () => {
    const node = pre(code(['language-ts'], text('const a = 1;')));
    expect(mermaidSource(node)).toBeNull();
  });

  it('returns null for a fence with no language', () => {
    const node = pre(code(undefined, text('plain text')));
    expect(mermaidSource(node)).toBeNull();
  });

  it('does not match a class that merely contains the name', () => {
    const node = pre(code(['language-mermaidish'], text('graph LR')));
    expect(mermaidSource(node)).toBeNull();
  });

  it('returns null for an empty fence rather than rendering an error', () => {
    expect(mermaidSource(pre(code(['language-mermaid'], text('   \n  '))))).toBeNull();
    expect(mermaidSource(pre(code(['language-mermaid'])))).toBeNull();
  });

  it('ignores whitespace text siblings around the code element', () => {
    const node = pre(text('\n'), code(['language-mermaid'], text('graph LR\n  A --> B')), text('\n'));
    expect(mermaidSource(node)).toBe('graph LR\n  A --> B');
  });

  it('returns null when the pre wraps something other than a lone code element', () => {
    const node = pre(
      code(['language-mermaid'], text('graph LR')),
      code(['language-mermaid'], text('graph LR')),
    );
    expect(mermaidSource(node)).toBeNull();
  });

  it('returns null for elements that are not a pre', () => {
    expect(mermaidSource(code(['language-mermaid'], text('graph LR')))).toBeNull();
    expect(mermaidSource(undefined)).toBeNull();
    expect(mermaidSource(text('graph LR'))).toBeNull();
  });
});

describe('mermaidThemeVariables', () => {
  it('maps palette slots onto mermaid theme variables', () => {
    const palette = appPaletteForId('graphite');
    const vars = mermaidThemeVariables(palette);
    expect(vars.background).toBe(palette.surface);
    expect(vars.textColor).toBe(palette.text);
    expect(vars.lineColor).toBe(palette.dim);
    expect(vars.nodeBorder).toBe(palette.cyan);
    expect(vars.errorTextColor).toBe(palette.red);
  });

  it('tracks the palette across themes', () => {
    const dark = mermaidThemeVariables(appPaletteForId('graphite'));
    const light = mermaidThemeVariables(appPaletteForId('graphite-light'));
    expect(dark.background).not.toBe(light.background);
    expect(dark.textColor).not.toBe(light.textColor);
  });

  it('inherits the app mono font so diagram labels match the preview', () => {
    expect(mermaidThemeVariables(appPaletteForId('graphite')).fontFamily).toBe(
      'var(--treeline-font-mono)',
    );
  });
});
