import type { DiffLine, FileDiff } from '@shared/types';

/** Human summary like "Added 3 lines, removed 1 line". */
function summarize(added: number, removed: number): string {
  const plural = (n: number) => (n === 1 ? 'line' : 'lines');
  if (added === 0 && removed === 0) return 'No changes';
  const parts: string[] = [];
  if (added > 0) parts.push(`Added ${added} ${plural(added)}`);
  if (removed > 0) parts.push(`removed ${removed} ${plural(removed)}`);
  return parts.join(', ');
}

/**
 * Unified-diff renderer: a per-file summary header, then red `-` / green `+`
 * rows with a line-number gutter (new line for adds/context, old line for
 * deletions). Long lines scroll horizontally rather than wrapping.
 */
export function DiffView({ diff }: { diff: FileDiff }) {
  return (
    <div className="h-full overflow-auto bg-treeline-surface font-mono text-[12px] leading-relaxed">
      <div className="sticky top-0 border-b border-treeline-highlight bg-treeline-surface px-3 py-1 text-xs text-treeline-dim">
        {summarize(diff.added, diff.removed)}
      </div>
      <div className="min-w-max py-1">
        {diff.lines.map((line, i) => (
          <DiffRow key={i} line={line} />
        ))}
      </div>
    </div>
  );
}

function DiffRow({ line }: { line: DiffLine }) {
  if (line.kind === 'hunk') {
    return (
      <div className="bg-treeline-highlight/40 px-3 py-0.5 text-treeline-dim">
        {line.text || '⋯'}
      </div>
    );
  }

  const num = line.kind === 'del' ? line.oldLine : line.newLine;
  const sign = line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' ';

  const rowBg =
    line.kind === 'add'
      ? 'bg-treeline-green/10'
      : line.kind === 'del'
        ? 'bg-treeline-red/10'
        : '';
  const numColor =
    line.kind === 'add'
      ? 'text-treeline-green/70'
      : line.kind === 'del'
        ? 'text-treeline-red/70'
        : 'text-treeline-dim';
  const signColor =
    line.kind === 'add'
      ? 'text-treeline-green'
      : line.kind === 'del'
        ? 'text-treeline-red'
        : 'text-treeline-dim';

  return (
    <div className={`flex ${rowBg}`}>
      <span
        className={`w-12 shrink-0 select-none pr-2 text-right ${numColor}`}
        aria-hidden="true"
      >
        {num ?? ''}
      </span>
      <span className={`w-4 shrink-0 select-none text-center ${signColor}`} aria-hidden="true">
        {sign}
      </span>
      <span className="whitespace-pre pr-3 text-treeline-text">{line.text}</span>
    </div>
  );
}
