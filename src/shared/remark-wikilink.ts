/**
 * Remark plugin that turns `[[wikilinks]]` in mdast text nodes into link nodes
 * with a `wikilink:` href, for the renderer's anchor override to resolve
 * in-app. Operating on the parsed tree (not the source string) makes code
 * safety structural: fenced blocks and inline code carry their content in
 * `code`/`inlineCode` node values, never as `text` children, so they are
 * untransformable by construction.
 *
 * mdast is typed structurally here to avoid importing the transitive
 * `@types/mdast` package. Dependency-free (no unist-util-visit).
 */
import { splitWikilinks, wikilinkHref } from './note-link';

export interface MdastNode {
  type: string;
  value?: string;
  url?: string;
  children?: MdastNode[];
}

// Don't descend into existing links — a nested anchor is invalid HTML and a
// wikilink inside `[text](url)` text is almost certainly literal.
const SKIP_CHILDREN = new Set(['link', 'linkReference']);

export function remarkWikilinks() {
  return (tree: MdastNode) => {
    walk(tree);
  };
}

function walk(node: MdastNode): void {
  const children = node.children;
  if (!children) return;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child.type === 'text' && typeof child.value === 'string') {
      const replacement = transformText(child.value);
      if (replacement) {
        children.splice(i, 1, ...replacement);
        i += replacement.length - 1;
      }
    } else if (!SKIP_CHILDREN.has(child.type)) {
      walk(child);
    }
  }
}

/** Returns replacement nodes, or null when the text contains no wikilinks. */
function transformText(value: string): MdastNode[] | null {
  const segments = splitWikilinks(value);
  if (!segments.some((s) => s.kind === 'wikilink')) return null;
  return segments.map((s) =>
    s.kind === 'text'
      ? { type: 'text', value: s.text }
      : {
          type: 'link',
          url: wikilinkHref(s.parts),
          children: [{ type: 'text', value: s.parts.alias ?? s.parts.target }],
        },
  );
}
