import { useEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { SearchFileResult, SearchLineMatch } from '@shared/types';
import { useStore } from '../store';
import { runContentSearch, openSearchHit } from '../actions/search';
import { basename } from '../util/path';

/** Debounce (ms) between the last keystroke and firing the search. */
const SEARCH_DEBOUNCE_MS = 250;

/**
 * Find-in-files results panel (⌘⇧F). Lives in the right-hand aux region (see
 * MainArea), scoped to the selected worktree/folder. Debounced search on the
 * query/options; results grouped per file with highlighted match spans;
 * clicking a line opens the file in the code viewer at that line.
 */
export function SearchPanel() {
  const {
    root,
    query,
    options,
    results,
    loading,
    error,
    collapsedFiles,
    setSearchQuery,
    toggleSearchOption,
    toggleFileCollapsed,
    closeSearchPanel,
  } = useStore(
    useShallow((s) => ({
      root: s.searchRoot,
      query: s.searchQuery,
      options: s.searchOptions,
      results: s.searchResults,
      loading: s.searchLoading,
      error: s.searchError,
      collapsedFiles: s.collapsedFiles,
      setSearchQuery: s.setSearchQuery,
      toggleSearchOption: s.toggleSearchOption,
      toggleFileCollapsed: s.toggleFileCollapsed,
      closeSearchPanel: s.closeSearchPanel,
    })),
  );
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the box whenever the panel (re)opens for a given root.
  useEffect(() => {
    inputRef.current?.focus();
  }, [root]);

  // Debounced auto-search on query/option changes.
  useEffect(() => {
    const id = setTimeout(() => void runContentSearch(), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [query, options]);

  const fileCount = results?.results.length ?? 0;
  const matchCount = results?.totalMatches ?? 0;

  return (
    <div
      data-ss="search-panel"
      className="flex h-full flex-col bg-treeline-surface text-treeline-text"
    >
      <div className="flex items-center justify-between border-b border-treeline-highlight px-3 py-2">
        <h2 className="text-sm text-treeline-cyan">Search</h2>
        <button
          type="button"
          onClick={closeSearchPanel}
          aria-label="Close search"
          className="rounded px-1 text-treeline-dim hover:bg-treeline-highlight hover:text-treeline-text"
        >
          ×
        </button>
      </div>

      <div className="flex flex-col gap-2 border-b border-treeline-highlight px-3 py-2">
        <div className="flex items-center gap-1">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void runContentSearch();
              if (e.key === 'Escape') closeSearchPanel();
            }}
            placeholder={root ? `Search in ${basename(root)}…` : 'Select a worktree or folder'}
            aria-label="Search query"
            disabled={!root}
            className="min-w-0 flex-1 rounded bg-treeline-highlight px-2 py-1 text-treeline-text placeholder:text-treeline-dim focus:outline-none focus:ring-1 focus:ring-treeline-cyan"
          />
          <OptionToggle
            label="Aa"
            title="Match case"
            active={options.caseSensitive === true}
            onClick={() => toggleSearchOption('caseSensitive')}
          />
          <OptionToggle
            label="ab"
            title="Match whole word"
            active={options.wholeWord === true}
            onClick={() => toggleSearchOption('wholeWord')}
          />
          <OptionToggle
            label=".*"
            title="Use regular expression"
            active={options.regex === true}
            onClick={() => toggleSearchOption('regex')}
          />
        </div>
        <SummaryLine
          root={root}
          loading={loading}
          error={error}
          query={query}
          fileCount={fileCount}
          matchCount={matchCount}
          truncated={results?.truncated === true}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-1 text-sm">
        {results?.results.map((file) => (
          <FileGroup
            key={file.path}
            file={file}
            collapsed={collapsedFiles[file.relPath] === true}
            onToggle={() => toggleFileCollapsed(file.relPath)}
          />
        ))}
      </div>
    </div>
  );
}

function SummaryLine({
  root,
  loading,
  error,
  query,
  fileCount,
  matchCount,
  truncated,
}: {
  root: string | null;
  loading: boolean;
  error: string | null;
  query: string;
  fileCount: number;
  matchCount: number;
  truncated: boolean;
}) {
  let text: string;
  if (!root) text = 'Select a worktree or folder in the sidebar first.';
  else if (error) text = `Search failed: ${error}`;
  else if (loading) text = 'Searching…';
  else if (query.trim().length === 0) text = '';
  else if (matchCount === 0) text = 'No results';
  else
    text = `${matchCount} ${matchCount === 1 ? 'result' : 'results'} in ${fileCount} ${
      fileCount === 1 ? 'file' : 'files'
    }${truncated ? ' (limited)' : ''}`;
  return <div className="text-xs text-treeline-dim">{text}</div>;
}

function OptionToggle({
  label,
  title,
  active,
  onClick,
}: {
  label: string;
  title: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      onClick={onClick}
      className={`rounded px-1.5 py-1 font-mono text-xs ${
        active
          ? 'bg-treeline-cyan/20 text-treeline-cyan'
          : 'text-treeline-dim hover:bg-treeline-highlight hover:text-treeline-text'
      }`}
    >
      {label}
    </button>
  );
}

function FileGroup({
  file,
  collapsed,
  onToggle,
}: {
  file: SearchFileResult;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <div data-ss="search-file" data-ss-file={file.relPath}>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-baseline gap-1.5 px-2 py-0.5 text-left hover:bg-treeline-highlight"
      >
        <span className="text-treeline-dim">{collapsed ? '▸' : '▾'}</span>
        <span className="truncate text-treeline-text">{basename(file.relPath)}</span>
        <span className="truncate text-xs text-treeline-dim">{file.relPath}</span>
        <span className="ml-auto pl-2 text-xs text-treeline-dim">{file.matches.length}</span>
      </button>
      {!collapsed &&
        file.matches.map((match, i) => (
          <MatchRow
            key={`${match.line}:${i}`}
            match={match}
            onClick={() => openSearchHit(file.path, match.line)}
          />
        ))}
    </div>
  );
}

function MatchRow({ match, onClick }: { match: SearchLineMatch; onClick: () => void }) {
  return (
    <button
      type="button"
      data-ss="search-match"
      onClick={onClick}
      className="flex w-full items-baseline gap-2 px-2 py-0.5 pl-7 text-left hover:bg-treeline-highlight"
    >
      <span className="w-10 shrink-0 text-right font-mono text-xs text-treeline-dim">
        {match.line}
      </span>
      <span className="truncate font-mono text-xs">
        <HighlightedLine match={match} />
      </span>
    </button>
  );
}

/** Render a match line with its submatch spans emphasised. */
function HighlightedLine({ match }: { match: SearchLineMatch }) {
  const { text, submatches } = match;
  if (submatches.length === 0) return <>{text.trimStart()}</>;
  // Leading whitespace is noise in a one-line preview; trim it and shift the
  // submatch offsets to match so highlights stay aligned.
  const leading = text.length - text.trimStart().length;
  const out: React.ReactNode[] = [];
  let cursor = 0;
  const trimmed = text.slice(leading);
  for (let i = 0; i < submatches.length; i++) {
    const sm = submatches[i];
    const start = Math.max(0, sm.start - leading);
    const end = Math.max(start, sm.end - leading);
    if (start > cursor) out.push(<span key={`t${i}`}>{trimmed.slice(cursor, start)}</span>);
    out.push(
      <span key={`m${i}`} className="bg-treeline-cyan/25 text-treeline-cyan">
        {trimmed.slice(start, end)}
      </span>,
    );
    cursor = end;
  }
  if (cursor < trimmed.length) out.push(<span key="tail">{trimmed.slice(cursor)}</span>);
  return <>{out}</>;
}
