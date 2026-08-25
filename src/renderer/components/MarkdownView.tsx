import { useEffect, useMemo, type ReactNode } from 'react';
import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import {
  parseWikilinkHref,
  resolveNoteTarget,
  WIKILINK_SCHEME,
  type NoteIndex,
} from '@shared/note-link';
import { remarkWikilinks } from '@shared/remark-wikilink';
import { mermaidSource, type HastNode } from '@shared/mermaid-block';
import { splitFrontmatter, parseFrontmatterEntries } from '@shared/frontmatter';
import { MermaidBlock } from './MermaidBlock';
import { useStore } from '../store';
import type { ViewerPaneId } from '../store/editor-slice';
import {
  containingRootFor,
  ensureNoteIndex,
  openRelativeNoteLink,
  openWikilink,
} from '../actions/vault';

/**
 * Rendered markdown view for the code panel's Preview mode. Renders to React
 * elements (never raw HTML), so it's safe under the app's strict CSP — no
 * `dangerouslySetInnerHTML`, and embedded raw HTML in the source is ignored.
 *
 * Styling matches the Graphite palette via element overrides (no typography
 * plugin). Fenced code blocks are highlighted by rehype-highlight; their colors
 * come from the `.hljs-*` rules in globals.css. ```mermaid fences are the one
 * exception: the `pre` override hands them to MermaidBlock, which mounts an SVG
 * mermaid generated and sanitised — see that file for why that stays within the
 * no-raw-HTML rule.
 *
 * External links open in the OS browser: `target="_blank"` routes the click
 * through the main process's setWindowOpenHandler, which only hands safe
 * schemes to the OS. Note links stay in-app: `[[wikilinks]]` (rewritten to
 * `wikilink:` hrefs by remarkWikilinks) resolve against the containing vault's
 * note index, and relative `.md` hrefs resolve against the previewed file's
 * directory — both open in this same panel. YAML frontmatter is split off and
 * rendered as a properties block instead of literal markdown.
 */
const components: Components = {
  h1: ({ children }) => (
    <h1 className="mt-6 mb-3 border-b border-treeline-highlight pb-1 text-xl font-semibold text-treeline-text first:mt-0">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-6 mb-3 border-b border-treeline-highlight pb-1 text-lg font-semibold text-treeline-text first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-5 mb-2 text-base font-semibold text-treeline-text first:mt-0">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="mt-4 mb-2 text-sm font-semibold text-treeline-text first:mt-0">{children}</h4>
  ),
  h5: ({ children }) => (
    <h5 className="mt-4 mb-2 text-sm font-semibold text-treeline-dim first:mt-0">{children}</h5>
  ),
  h6: ({ children }) => (
    <h6 className="mt-4 mb-2 text-xs font-semibold uppercase tracking-wide text-treeline-dim first:mt-0">
      {children}
    </h6>
  ),
  p: ({ children }) => <p className="my-3 leading-relaxed text-treeline-text">{children}</p>,
  // `a` is provided per render by makeAnchor (it needs the vault context).
  ul: ({ children }) => <ul className="my-3 list-disc pl-6 text-treeline-text">{children}</ul>,
  ol: ({ children }) => <ol className="my-3 list-decimal pl-6 text-treeline-text">{children}</ol>,
  li: ({ children }) => <li className="my-1 leading-relaxed">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="my-3 border-l-2 border-treeline-highlight pl-3 text-treeline-dim">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-5 border-treeline-highlight" />,
  img: ({ src, alt }) => (
    <img src={src} alt={alt} className="my-3 max-w-full rounded border border-treeline-highlight" />
  ),
  // Inline code only; fenced blocks come through as <pre><code> and are styled
  // by the `pre`/`.hljs` rules below.
  code: ({ className, children, ...props }) => {
    const isBlock = typeof className === 'string' && className.includes('language-');
    if (isBlock) {
      return (
        <code className={className} {...props}>
          {children}
        </code>
      );
    }
    return (
      <code className="rounded bg-treeline-highlight px-1 py-0.5 font-mono text-[0.85em] text-treeline-text">
        {children}
      </code>
    );
  },
  // ```mermaid fences become diagrams; every other fence stays a code block.
  // The swap happens here rather than in `code` because the diagram replaces
  // the whole block — rendering it inside this styled `pre` would nest it in
  // the code-block chrome and inherit the mono/pre text styling.
  pre: ({ node, children }) => {
    const diagram = mermaidSource(node as HastNode | undefined);
    if (diagram !== null) return <MermaidBlock code={diagram} />;
    return (
      <pre className="my-3 overflow-x-auto rounded border border-treeline-highlight bg-treeline-highlight/40 p-3 font-mono text-xs leading-relaxed">
        {children}
      </pre>
    );
  },
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-treeline-highlight px-2 py-1 text-left font-semibold text-treeline-text">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-treeline-highlight px-2 py-1 text-treeline-text">{children}</td>
  ),
};

// The default transform strips unknown protocols, which would empty every
// wikilink: href — whitelist the scheme explicitly.
function urlTransform(url: string): string {
  return url.startsWith(WIKILINK_SCHEME) ? url : defaultUrlTransform(url);
}

/** True for hrefs like `./note.md` or `sub/note.md` — no scheme, not a fragment. */
function isRelativeHref(href: string): boolean {
  return !/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith('#') && !href.startsWith('//');
}

const anchorClass =
  'text-treeline-cyan underline decoration-treeline-cyan/40 hover:decoration-treeline-cyan';

/**
 * Anchor override that routes note links in-app. Built per render because it
 * closes over the current file's vault root and note index.
 */
function makeAnchor(
  root: string | null,
  index: NoteIndex | undefined,
  filePath: string | undefined,
  paneId: ViewerPaneId,
): Components['a'] {
  const Anchor = ({ children, href }: { children?: ReactNode; href?: string }) => {
    const url = href ?? '';

    if (url.startsWith(WIKILINK_SCHEME)) {
      const parts = parseWikilinkHref(url);
      const target = parts
        ? parts.heading
          ? `${parts.target}#${parts.heading}`
          : parts.target
        : null;
      const unresolved =
        !target || root === null || (index !== undefined && !resolveNoteTarget(index, target));
      if (unresolved) {
        return (
          <span
            className="text-treeline-dim"
            title={`Note not found: ${target ?? url}`}
            data-ss="wikilink-missing"
          >
            {children}
          </span>
        );
      }
      return (
        <a
          href={url}
          className={anchorClass}
          data-ss="wikilink"
          onClick={(e) => {
            e.preventDefault();
            void openWikilink(root, target, paneId);
          }}
        >
          {children}
        </a>
      );
    }

    if (url.startsWith('#')) {
      // In-document heading links: no scroll support in v1 — inert.
      return (
        <a href={url} className={anchorClass} onClick={(e) => e.preventDefault()}>
          {children}
        </a>
      );
    }

    if (filePath && url.length > 0 && isRelativeHref(url)) {
      return (
        <a
          href={url}
          className={anchorClass}
          data-ss="relative-link"
          onClick={(e) => {
            e.preventDefault();
            void openRelativeNoteLink(filePath, url, paneId);
          }}
        >
          {children}
        </a>
      );
    }

    // External (http/https/mailto/…): unchanged — target=_blank routes through
    // the main process's safe-URL gate.
    return (
      <a href={url} target="_blank" rel="noreferrer" className={anchorClass}>
        {children}
      </a>
    );
  };
  return Anchor;
}

/** Compact properties table for a note's YAML frontmatter. */
function FrontmatterBlock({ yaml }: { yaml: string }) {
  const entries = parseFrontmatterEntries(yaml);
  if (entries.length === 0) return null;
  return (
    <div className="mb-4 rounded border border-treeline-highlight px-3 py-2" data-ss="frontmatter">
      <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        {entries.map((e) => (
          <div key={e.key} className="contents">
            <span className="font-mono text-xs text-treeline-dim">{e.key}</span>
            {Array.isArray(e.value) ? (
              <span className="flex flex-wrap gap-1">
                {e.value.map((v, i) => (
                  <span
                    key={`${v}-${i}`}
                    className="rounded bg-treeline-highlight px-1.5 text-xs leading-5 text-treeline-text"
                  >
                    {v}
                  </span>
                ))}
              </span>
            ) : (
              <span className="text-xs leading-5 text-treeline-text">{e.value}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

const remarkPlugins = [remarkGfm, remarkWikilinks];

export function MarkdownView({
  source,
  filePath,
  paneId,
}: {
  source: string;
  filePath?: string;
  paneId: ViewerPaneId;
}) {
  const root = filePath ? containingRootFor(filePath) : null;
  const index = useStore((s) => (root ? s.noteIndexByRoot[root] : undefined));

  // Rebuild the note index whenever a (different) note is opened — plain
  // folders have no fs watcher, so this is the staleness bound.
  useEffect(() => {
    if (root) void ensureNoteIndex(root);
  }, [root, filePath]);

  const { yaml, body } = useMemo(() => splitFrontmatter(source), [source]);

  const mergedComponents = useMemo<Components>(
    () => ({ ...components, a: makeAnchor(root, index, filePath, paneId) }),
    [root, index, filePath, paneId],
  );

  return (
    <div className="h-full overflow-auto px-5 py-4 text-sm">
      {yaml !== null && <FrontmatterBlock yaml={yaml} />}
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={[rehypeHighlight]}
        components={mergedComponents}
        urlTransform={urlTransform}
      >
        {body}
      </ReactMarkdown>
    </div>
  );
}
