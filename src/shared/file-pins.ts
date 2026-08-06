import type { Folder, Repo, Worktree } from './types';

/** A root in which files may be pinned, plus its user-facing label. */
export interface FilePinRoot {
  path: string;
  label: string;
}

/** Flatten the renderer's catalog into roots suitable for pin eligibility/labels. */
export function buildFilePinRoots(
  repos: Repo[],
  folders: Folder[],
  worktreesByRepo: Record<string, Worktree[]>,
): FilePinRoot[] {
  return [
    ...Object.values(worktreesByRepo).flatMap((worktrees) =>
      worktrees.map((worktree) => ({
        path: worktree.path,
        label: worktree.branch || worktree.path.split('/').pop() || worktree.path,
      })),
    ),
    ...folders.map((folder) => ({ path: folder.path, label: folder.name })),
    ...repos.map((repo) => ({ path: repo.path, label: repo.name })),
  ];
}

/** Drop malformed/duplicate persisted values while preserving their order. */
export function sanitizePinnedFilePaths(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const value of raw) {
    if (typeof value !== 'string' || !value.startsWith('/') || seen.has(value)) continue;
    seen.add(value);
    paths.push(value);
  }
  return paths;
}

/** Toggle a pin without duplicates; newly-added paths always move to the top. */
export function togglePinnedFilePath(paths: string[], path: string): string[] {
  return paths.includes(path) ? paths.filter((candidate) => candidate !== path) : [path, ...paths];
}

/** True when `path` is the root itself or a child on a path-segment boundary. */
export function pathIsInside(path: string, root: string): boolean {
  const normalizedRoot = root.replace(/\/+$/, '');
  return path === normalizedRoot || path.startsWith(`${normalizedRoot}/`);
}

/** The most-specific registered root containing a file, if one exists. */
export function containingFilePinRoot(filePath: string, roots: FilePinRoot[]): FilePinRoot | null {
  let best: FilePinRoot | null = null;
  for (const root of roots) {
    if (pathIsInside(filePath, root.path) && (!best || root.path.length > best.path.length)) {
      best = root;
    }
  }
  return best;
}

/**
 * Compact context shown below a pinned basename. Prefer the registered root's
 * label plus the relative parent; fall back to the absolute parent if that root
 * has since been removed from Treeline.
 */
export function pinnedFileContext(filePath: string, roots: FilePinRoot[]): string {
  const slash = filePath.lastIndexOf('/');
  const parent = slash > 0 ? filePath.slice(0, slash) : '/';
  const root = containingFilePinRoot(filePath, roots);
  if (!root) return parent;
  const relativeParent = parent.slice(root.path.replace(/\/+$/, '').length).replace(/^\/+/, '');
  return relativeParent ? `${root.label} · ${relativeParent}` : root.label;
}
