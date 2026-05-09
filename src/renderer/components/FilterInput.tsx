import { useStore } from '../store';

export function FilterInput() {
  const filter = useStore((s) => s.filter);
  const setFilter = useStore((s) => s.setFilter);

  return (
    <input
      type="text"
      value={filter}
      onChange={(e) => setFilter(e.target.value)}
      placeholder="Filter…"
      className="w-full rounded bg-treeline-highlight px-2 py-1 text-treeline-text placeholder:text-treeline-dim focus:outline-none focus:ring-1 focus:ring-treeline-cyan"
    />
  );
}
