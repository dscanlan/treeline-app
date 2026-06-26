import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../../store';
import { openFileInPanel } from '../../actions/editor';
import { fuzzyFilter, type FuzzyMatch } from '@shared/fuzzy';
import { basename, joinPath } from '../../util/path';

/**
 * ⌘P quick-open: a fuzzy file finder scoped to the selected worktree/folder
 * (`root`). Enumerates files once via `search.files` (ripgrep, .gitignore-aware)
 * then filters client-side per keystroke — opening the chosen file in the code
 * panel. A top-anchored palette rather than a centred dialog, so it doesn't
 * reuse ModalShell.
 */
const MAX_RESULTS = 200;

/** Render `text` with the fuzzy-matched character indices emphasised. */
function Highlighted({ text, indices }: { text: string; indices: number[] }) {
  if (indices.length === 0) return <>{text}</>;
  const set = new Set(indices);
  return (
    <>
      {[...text].map((ch, i) =>
        set.has(i) ? (
          <span key={i} className="text-treeline-cyan">
            {ch}
          </span>
        ) : (
          <span key={i}>{ch}</span>
        ),
      )}
    </>
  );
}

export function QuickOpenModal({ root }: { root: string }) {
  const closeModal = useStore((s) => s.closeModal);
  const [files, setFiles] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  // Enumerate the target's files once when the palette opens.
  useEffect(() => {
    let cancelled = false;
    window.treeline.search
      .files(root)
      .then((list) => {
        if (!cancelled) setFiles(list);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [root]);

  const results = useMemo(() => {
    if (!files) return [];
    return fuzzyFilter(files, query.trim(), (f) => f, MAX_RESULTS);
  }, [files, query]);

  // Keep the active index in range as the result set shrinks.
  useEffect(() => {
    setActive(0);
  }, [query]);

  // Scroll the active row into view on keyboard navigation.
  useEffect(() => {
    const el = listRef.current?.children[active] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const open = (relPath: string) => {
    closeModal();
    void openFileInPanel(joinPath(root, relPath));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const chosen = results[active];
      if (chosen) open(chosen.item);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeModal();
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Go to file"
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[12vh]"
      onClick={closeModal}
    >
      <div
        className="flex max-h-[70vh] w-[min(640px,90vw)] flex-col overflow-hidden rounded border border-treeline-highlight bg-treeline-surface text-treeline-text shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Go to file…"
          aria-label="Go to file"
          className="border-b border-treeline-highlight bg-transparent px-3 py-2 text-treeline-text placeholder:text-treeline-dim focus:outline-none"
        />
        <ul ref={listRef} className="overflow-y-auto">
          {error && <li className="px-3 py-2 text-treeline-dim">Search unavailable: {error}</li>}
          {!error && files === null && (
            <li className="px-3 py-2 text-treeline-dim">Indexing files…</li>
          )}
          {!error && files !== null && results.length === 0 && (
            <li className="px-3 py-2 text-treeline-dim">
              {query.trim() ? 'No matching files' : 'No files'}
            </li>
          )}
          {results.map((r, i) => {
            const rel = r.item;
            const name = basename(rel);
            const dir = rel.slice(0, rel.length - name.length);
            const match: FuzzyMatch = r.match;
            // Map the basename's matched indices into the basename substring.
            const nameStart = dir.length;
            const nameIndices = match.indices
              .filter((idx) => idx >= nameStart)
              .map((idx) => idx - nameStart);
            return (
              <li
                key={rel}
                data-ss="quick-open-item"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => open(rel)}
                className={`flex cursor-pointer items-baseline gap-2 px-3 py-1 ${
                  i === active ? 'bg-treeline-highlight' : ''
                }`}
              >
                <span className="truncate">
                  <Highlighted text={name} indices={nameIndices} />
                </span>
                {dir && <span className="truncate text-xs text-treeline-dim">{dir}</span>}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
