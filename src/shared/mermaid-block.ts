/**
 * Pure helpers for rendering ```mermaid fences as diagrams in the markdown
 * preview.
 *
 * `mermaidSource` recognises the hast shape a fenced mermaid block parses to
 * (`pre > code.language-mermaid`) so the renderer's `pre` override can swap the
 * code block for a diagram. Detection lives here — not in the component — so it
 * is testable without a DOM, and so the component stays purely about the async
 * mermaid lifecycle.
 *
 * `mermaidThemeVariables` maps the app palette onto mermaid's `base` theme, so
 * diagrams repaint with the rest of the chrome when the Appearance setting
 * changes instead of rendering mermaid's stock light colors on a dark surface.
 *
 * hast is typed structurally here for the same reason as remark-wikilink's
 * mdast types: no transitive `@types/hast` import.
 */
import type { AppPalette } from './terminal-theme';

export interface HastNode {
  type: string;
  tagName?: string;
  properties?: { className?: unknown };
  children?: HastNode[];
  value?: string;
}

const MERMAID_CLASS = 'language-mermaid';

/** hast stores `class` pre-split, but tolerate a raw string too. */
function hasMermaidClass(className: unknown): boolean {
  if (Array.isArray(className)) return className.includes(MERMAID_CLASS);
  if (typeof className === 'string') return className.split(/\s+/).includes(MERMAID_CLASS);
  return false;
}

/** Concatenated text descendants — a fence's content is one text node, but
 * highlighters can split it, so join rather than assume. */
function textContent(node: HastNode): string {
  if (node.type === 'text') return node.value ?? '';
  return (node.children ?? []).map(textContent).join('');
}

/**
 * The mermaid source inside a `pre` element, or null when this `pre` is an
 * ordinary code block. Returns null for a blank fence so an empty diagram
 * renders as the (empty) code block it is, rather than a mermaid error.
 */
export function mermaidSource(node: HastNode | undefined): string | null {
  if (!node || node.type !== 'element' || node.tagName !== 'pre') return null;
  const elements = (node.children ?? []).filter((c) => c.type === 'element');
  if (elements.length !== 1) return null;
  const code = elements[0];
  if (code.tagName !== 'code') return null;
  if (!hasMermaidClass(code.properties?.className)) return null;
  const source = textContent(code).trim();
  return source.length > 0 ? source : null;
}

/**
 * Palette-derived overrides for mermaid's `base` theme. Only the core variables
 * are set; mermaid derives the per-diagram-type rest from these.
 */
export function mermaidThemeVariables(palette: AppPalette): Record<string, string> {
  return {
    background: palette.surface,
    mainBkg: palette.highlight,
    primaryColor: palette.highlight,
    primaryTextColor: palette.text,
    primaryBorderColor: palette.cyan,
    secondaryColor: palette.surface,
    secondaryTextColor: palette.text,
    secondaryBorderColor: palette.dim,
    tertiaryColor: palette.surface,
    tertiaryTextColor: palette.text,
    tertiaryBorderColor: palette.dim,
    nodeBorder: palette.cyan,
    nodeTextColor: palette.text,
    lineColor: palette.dim,
    textColor: palette.text,
    titleColor: palette.text,
    edgeLabelBackground: palette.surface,
    clusterBkg: palette.surface,
    clusterBorder: palette.dim,
    errorBkgColor: palette.surface,
    errorTextColor: palette.red,
    // Inherit the app's mono stack so diagram labels match the rest of preview.
    fontFamily: 'var(--treeline-font-mono)',
    fontSize: '13px',
  };
}
