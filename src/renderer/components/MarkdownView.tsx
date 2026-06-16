import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';

/**
 * Rendered markdown view for the code panel's Preview mode. Renders to React
 * elements (never raw HTML), so it's safe under the app's strict CSP — no
 * `dangerouslySetInnerHTML`, and embedded raw HTML in the source is ignored.
 *
 * Styling matches the Graphite palette via element overrides (no typography
 * plugin). Fenced code blocks are highlighted by rehype-highlight; their colors
 * come from the `.hljs-*` rules in globals.css.
 *
 * Links open in the OS browser: `target="_blank"` routes the click through the
 * main process's setWindowOpenHandler, which only hands safe schemes to the OS.
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
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-treeline-cyan underline decoration-treeline-cyan/40 hover:decoration-treeline-cyan"
    >
      {children}
    </a>
  ),
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
  pre: ({ children }) => (
    <pre className="my-3 overflow-x-auto rounded border border-treeline-highlight bg-treeline-highlight/40 p-3 font-mono text-xs leading-relaxed">
      {children}
    </pre>
  ),
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

export function MarkdownView({ source }: { source: string }) {
  return (
    <div className="h-full overflow-auto px-5 py-4 text-sm">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={components}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
