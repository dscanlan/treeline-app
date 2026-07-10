import type { Folder } from '@shared/types';
import { useStore } from '../store';
import { toggleDir } from '../actions/editor';
import { openTabAt } from '../actions/tabs';
import { FileTree } from './FileTree';

interface Props {
  folder: Folder;
}

/**
 * A plain (non-git) directory pinned to the sidebar: a top-level row that roots a
 * bare {@link FileTree} with no worktrees and no Changed/diff tab. The expand
 * state and child-loading both ride on `toggleDir(folder.path)` — the same lazy
 * mechanism the worktree rows use — so the root's children populate on first open.
 */
export function FolderNode({ folder }: Props) {
  const open = useStore((s) => !!s.expandedDirs[folder.path]);
  const setFolders = useStore((s) => s.setFolders);
  const selected = useStore((s) => s.selectedSidebarPath === folder.path);

  const onRemove = async () => {
    await window.treeline.folders.remove(folder.path);
    const cfg = await window.treeline.config.get();
    setFolders(cfg.folders);
  };

  /** Open a fresh terminal at the folder — a plain dir is a valid cwd. */
  const onNewTerminal = () => void openTabAt(folder.path, { forceNew: true });

  return (
    <div className="group/folder mt-2" data-ss="folder-node" data-ss-folder={folder.path}>
      <div
        className={`flex items-center gap-1 rounded px-2 py-1 ${
          selected ? 'bg-treeline-highlight' : 'hover:bg-treeline-highlight'
        }`}
      >
        <button
          type="button"
          onClick={() => {
            // Selecting the folder makes it the ⌘P / ⌘⇧F search scope, like a
            // worktree row.
            useStore.getState().setSelected(folder.path);
            void toggleDir(folder.path);
          }}
          aria-expanded={open}
          title={folder.path}
          className="flex flex-1 items-center gap-2 text-left text-treeline-text"
        >
          <span className="text-xs text-treeline-dim">{open ? '▾' : '▸'}</span>
          <FolderGlyph open={open} />
          <span className="truncate font-medium">{folder.name}</span>
        </button>
        <button
          type="button"
          onClick={onNewTerminal}
          title="New terminal in folder"
          aria-label="New terminal in folder"
          className="rounded px-1 font-mono text-[11px] text-treeline-dim opacity-0 hover:bg-treeline-surface hover:text-treeline-cyan group-hover/folder:opacity-100"
        >
          &gt;_
        </button>
        <button
          type="button"
          onClick={onRemove}
          title="Remove folder from sidebar"
          aria-label="Remove folder from sidebar"
          className="rounded px-1 text-treeline-dim opacity-0 hover:bg-treeline-surface hover:text-treeline-red group-hover/folder:opacity-100"
        >
          ×
        </button>
      </div>
      {open && (
        <div className="mt-1">
          <FileTree dirPath={folder.path} depth={0} />
        </div>
      )}
    </div>
  );
}

/** Lucide-style folder glyph, matching the worktree rows' "browse files" icon. */
function FolderGlyph({ open }: { open: boolean }) {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-treeline-dim"
      aria-hidden="true"
    >
      {open ? (
        <path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />
      ) : (
        <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
      )}
    </svg>
  );
}
