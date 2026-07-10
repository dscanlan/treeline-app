// Vault-reader orchestration: figure out which pinned root a note belongs to,
// build/cache the note index for that root, and open wikilink / relative-link
// targets in the code panel. Keeps the IPC dance out of MarkdownView,
// mirroring actions/editor.ts.
import {
  buildNoteIndex,
  dirnamePosix,
  resolveNoteTarget,
  resolveRelativeHref,
  type NoteIndex,
} from '@shared/note-link';
import { useStore } from '../store';
import { joinPath } from '../util/path';
import { openFileInPanel } from './editor';

function contains(root: string, filePath: string): boolean {
  return filePath === root || filePath.startsWith(`${root.replace(/\/+$/, '')}/`);
}

/**
 * The root wikilinks in `filePath` resolve against. The configured vault path
 * (Settings → Notes) wins when the file is inside it; otherwise the longest
 * containing pinned root — folders, worktrees, then repo toplevels — so the
 * feature works on any pinned markdown tree with zero configuration.
 */
export function containingRootFor(filePath: string): string | null {
  const s = useStore.getState();

  const vaultPath = s.settings.vaultPath;
  if (vaultPath && contains(vaultPath, filePath)) return vaultPath;

  let best: string | null = null;
  const consider = (root: string) => {
    if (contains(root, filePath) && (best === null || root.length > best.length)) best = root;
  };
  for (const f of s.folders) consider(f.path);
  for (const wts of Object.values(s.worktreesByRepo)) for (const wt of wts) consider(wt.path);
  for (const r of s.repos) consider(r.path);
  return best;
}

// One in-flight listing per root, so a burst of markdown opens doesn't stack
// duplicate `search.files` calls.
const inFlight = new Map<string, Promise<NoteIndex>>();

/**
 * Build (or rebuild) the note index for `root` from the ripgrep file listing
 * and cache it in the store. Callers re-run this per note open — that's the
 * staleness bound, since plain folders have no fs watcher.
 */
export async function ensureNoteIndex(root: string): Promise<NoteIndex> {
  const pending = inFlight.get(root);
  if (pending) return pending;
  const task = (async () => {
    const relPaths = await window.treeline.search.files(root);
    const index = buildNoteIndex(relPaths);
    useStore.getState().setNoteIndex(root, index);
    return index;
  })();
  inFlight.set(root, task);
  try {
    return await task;
  } finally {
    inFlight.delete(root);
  }
}

/**
 * Open the note a wikilink points at, resolving `target` against `root`'s
 * index (awaiting the index if it's still building). Unresolvable targets are
 * a no-op — the anchor renders as a dim span once the index is loaded, so this
 * only races the very first click.
 */
export async function openWikilink(root: string, target: string): Promise<void> {
  const index = useStore.getState().noteIndexByRoot[root] ?? (await ensureNoteIndex(root));
  const rel = resolveNoteTarget(index, target);
  if (rel) await openFileInPanel(joinPath(root, rel));
}

/**
 * Open a relative markdown-style link (`[text](../other.md)`) against the
 * directory of the file being previewed. Escaping paths resolve to null and
 * no-op; a missing target surfaces as the panel's normal read error.
 */
export async function openRelativeNoteLink(currentFilePath: string, href: string): Promise<void> {
  const abs = resolveRelativeHref(dirnamePosix(currentFilePath), href);
  if (abs) await openFileInPanel(abs);
}
