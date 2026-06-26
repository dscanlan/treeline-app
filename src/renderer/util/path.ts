// Tiny path helpers for renderer code (we can't import Node's `path` module).

export function basename(p: string): string {
  if (!p) return '';
  // Strip any trailing slashes, then take everything after the last slash.
  const trimmed = p.replace(/\/+$/, '');
  const idx = trimmed.lastIndexOf('/');
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}

/** Join an absolute `root` with a `rel` path under it (POSIX-only, like the rest). */
export function joinPath(root: string, rel: string): string {
  return `${root.replace(/\/+$/, '')}/${rel.replace(/^\/+/, '')}`;
}

const MARKDOWN_EXTS = new Set(['md', 'markdown', 'mdx']);

/** True for markdown files (.md / .markdown / .mdx) — drives the Preview view. */
export function isMarkdownPath(p: string): boolean {
  const name = basename(p);
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return false;
  return MARKDOWN_EXTS.has(name.slice(dot + 1).toLowerCase());
}
