import { useStore } from '../store';
import { setWorktreeFileView } from '../actions/editor';
import { FileTree } from './FileTree';
import { ChangedFilesList } from './ChangedFilesList';

/**
 * The body shown under an expanded worktree row: an `All | Changed` toggle and
 * either the full lazy file tree or the flat working-tree change list.
 */
export function WorktreeFiles({ worktreePath }: { worktreePath: string }) {
  const view = useStore((s) => s.worktreeFileView[worktreePath] ?? 'all');

  return (
    <div className="mb-1">
      <div className="flex items-center gap-1 px-2 pb-1 pl-6">
        <ViewTab
          label="All"
          active={view === 'all'}
          onClick={() => setWorktreeFileView(worktreePath, 'all')}
        />
        <ViewTab
          label="Changed"
          active={view === 'changed'}
          onClick={() => setWorktreeFileView(worktreePath, 'changed')}
        />
      </div>
      {view === 'all' ? (
        <FileTree dirPath={worktreePath} depth={0} />
      ) : (
        <ChangedFilesList worktreePath={worktreePath} />
      )}
    </div>
  );
}

function ViewTab({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded px-2 py-0.5 text-[11px] ${
        active
          ? 'bg-treeline-highlight text-treeline-text'
          : 'text-treeline-dim hover:text-treeline-text'
      }`}
    >
      {label}
    </button>
  );
}
