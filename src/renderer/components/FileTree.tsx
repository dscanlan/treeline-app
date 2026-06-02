import { useShallow } from 'zustand/react/shallow';
import type { DirEntry } from '@shared/types';
import { useStore } from '../store';
import { openFileInPanel, toggleDir } from '../actions/editor';

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
  const { expanded, selected } = useStore(
    useShallow((s) => ({
      expanded: !!s.expandedDirs[entry.path],
      selected: s.openFilePath === entry.path,
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
    <button
      type="button"
      onClick={() => void openFileInPanel(entry.path)}
      title={entry.path}
      style={{ paddingLeft: padLeft }}
      className={`flex w-full items-center gap-1.5 rounded py-0.5 pr-2 text-left ${
        selected
          ? 'bg-treeline-highlight text-treeline-text'
          : 'text-treeline-dim hover:bg-treeline-highlight/60 hover:text-treeline-text'
      }`}
    >
      {/* spacer to align file names with dir names (no chevron) */}
      <span className="w-3 shrink-0" />
      <span className="truncate">{entry.name}</span>
    </button>
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
