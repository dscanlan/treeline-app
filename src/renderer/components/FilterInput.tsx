import { useEffect, useRef } from 'react';
import { useStore } from '../store';

export function FilterInput() {
  const filter = useStore((s) => s.filter);
  const setFilter = useStore((s) => s.setFilter);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA';
      const shortcut = event.metaKey && event.shiftKey && event.key.toLowerCase() === 'o';
      if (!shortcut && (typing || event.key !== '/')) return;
      event.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="search"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setFilter('');
            e.currentTarget.blur();
          }
        }}
        placeholder="Find repos or branches…"
        aria-label="Find repository, worktree, or folder"
        className="w-full rounded bg-treeline-highlight py-1 pl-2 pr-7 text-treeline-text placeholder:text-treeline-dim focus:outline-none focus:ring-1 focus:ring-treeline-cyan"
      />
      {filter && (
        <button
          type="button"
          onClick={() => setFilter('')}
          title="Clear filter"
          aria-label="Clear filter"
          className="absolute right-1 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-treeline-dim hover:bg-treeline-surface hover:text-treeline-text"
        >
          ×
        </button>
      )}
    </div>
  );
}
