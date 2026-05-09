// Tiny path helpers for renderer code (we can't import Node's `path` module).

export function basename(p: string): string {
  if (!p) return '';
  // Strip any trailing slashes, then take everything after the last slash.
  const trimmed = p.replace(/\/+$/, '');
  const idx = trimmed.lastIndexOf('/');
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}
