import { useShallow } from 'zustand/react/shallow';
import type { DirEntry } from '@shared/types';
import { useStore } from '../store';
import { openFileInPanel, toggleDir, toggleFilePin } from '../actions/editor';

/** Indentation step per tree depth, in px. */
const INDENT = 12;
/** Base left padding so depth-0 rows align under the worktree label. */
const BASE_PAD = 8;

/**
 * Lazily-rendered file tree for one directory. Children come from the editor
 * slice's `dirChildren` cache (populated by `toggleDir`/`openFileInPanel`'s
 * sibling action). Rendered under a worktree row once it's expanded.
 */
export function FileTree({ dirPath, depth }: { dirPath: string; depth: number }) {
  const children = useStore((s) => s.dirChildren[dirPath]);

  if (children === undefined) {
    return <LeafText depth={depth}>loading…</LeafText>;
  }
  if (children.length === 0) {
    return <LeafText depth={depth}>empty</LeafText>;
  }
  return (
    <>
      {children.map((entry) => (
        <FileTreeNode key={entry.path} entry={entry} depth={depth} />
      ))}
    </>
  );
}

function FileTreeNode({ entry, depth }: { entry: DirEntry; depth: number }) {
  const { expanded, selected, pinned } = useStore(
    useShallow((s) => ({
      expanded: !!s.expandedDirs[entry.path],
      selected: s.activeFilePath === entry.path,
      pinned: s.pinnedFilePaths.includes(entry.path),
    })),
  );
  const padLeft = BASE_PAD + depth * INDENT;

  if (entry.type === 'dir') {
    return (
      <>
        <button
          type="button"
          onClick={() => void toggleDir(entry.path)}
          title={entry.path}
          style={{ paddingLeft: padLeft }}
          className="flex w-full items-center gap-1.5 rounded py-0.5 pr-2 text-left text-treeline-text hover:bg-treeline-highlight/60"
        >
          <span className="w-3 shrink-0 text-center text-[10px] text-treeline-dim">
            {expanded ? '▾' : '▸'}
          </span>
          <span className="truncate">{entry.name}</span>
        </button>
        {expanded && <FileTree dirPath={entry.path} depth={depth + 1} />}
      </>
    );
  }

  return (
    <div
      className={`group/file flex w-full items-center rounded ${
        selected ? 'bg-treeline-highlight' : 'hover:bg-treeline-highlight/60'
      }`}
    >
      <button
        type="button"
        onClick={() => void openFileInPanel(entry.path)}
        title={entry.path}
        style={{ paddingLeft: padLeft }}
        className={`flex min-w-0 flex-1 items-center gap-1.5 py-0.5 text-left ${
          selected ? 'text-treeline-text' : 'text-treeline-dim hover:text-treeline-text'
        }`}
      >
        {/* spacer to align file names with dir names (no chevron) */}
        <span className="w-3 shrink-0" />
        <span className="truncate">{entry.name}</span>
      </button>
      <button
        type="button"
        onClick={() => toggleFilePin(entry.path)}
        title={pinned ? 'Unpin file' : 'Pin file'}
        aria-label={`${pinned ? 'Unpin' : 'Pin'} ${entry.name}`}
        aria-pressed={pinned}
        className={`mr-1 shrink-0 rounded px-1 hover:bg-treeline-surface group-hover/file:opacity-100 ${
          pinned
            ? 'text-treeline-yellow opacity-100'
            : 'text-treeline-dim opacity-0 hover:text-treeline-text'
        }`}
      >
        {pinned ? '★' : '☆'}
      </button>
    </div>
  );
}

function LeafText({ depth, children }: { depth: number; children: React.ReactNode }) {
  return (
    <div
      style={{ paddingLeft: BASE_PAD + depth * INDENT + 18 }}
      className="py-0.5 text-xs italic text-treeline-dim"
    >
      {children}
    </div>
  );
}
