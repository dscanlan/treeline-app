// Find-in-files orchestration: run a content search against the selected
// target and open a hit in the code panel. Keeps the IPC dance out of the
// SearchPanel component, mirroring actions/editor.ts.
import { useStore } from '../store';
import { openFileAtLine } from './editor';

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Run the current query/options against the current search root. No-ops without
 * a root or with an empty query (clearing results in the latter case so the
 * panel doesn't show stale hits).
 */
export async function runContentSearch(): Promise<void> {
  const s = useStore.getState();
  const root = s.searchRoot;
  const query = s.searchQuery.trim();
  if (!root) return;
  if (query.length === 0) {
    s.applySearchResults(s.searchQuery, root, { results: [], totalMatches: 0, truncated: false });
    return;
  }
  s.setSearchLoading(true);
  try {
    const result = await window.treeline.search.content(root, query, s.searchOptions);
    useStore.getState().applySearchResults(s.searchQuery, root, result);
  } catch (err) {
    useStore.getState().setSearchError(errMsg(err));
  }
}

/** Open a search hit: load the file and scroll to the matched line. */
export function openSearchHit(path: string, line: number): void {
  void openFileAtLine(path, line);
}
