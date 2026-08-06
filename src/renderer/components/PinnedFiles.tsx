import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { buildFilePinRoots, pinnedFileContext } from '@shared/file-pins';
import { useStore } from '../store';
import { openPinnedFile, toggleFilePin } from '../actions/editor';
import { basename } from '../util/path';

/** Persistent global file shortcuts shown above either sidebar navigator. */
export function PinnedFiles() {
  const state = useStore(
    useShallow((s) => ({
      paths: s.pinnedFilePaths,
      missing: s.missingPinnedFiles,
      repos: s.repos,
      folders: s.folders,
      worktreesByRepo: s.worktreesByRepo,
      selectedPath: s.openFilePath,
    })),
  );
  const roots = useMemo(
    () => buildFilePinRoots(state.repos, state.folders, state.worktreesByRepo),
    [state.folders, state.repos, state.worktreesByRepo],
  );

  if (state.paths.length === 0) return null;

  return (
    <section
      className="shrink-0 border-b border-treeline-highlight px-1 pb-2"
      aria-label="Pinned files"
      data-ss="pinned-files"
    >
      <div className="px-2 pb-1 text-[10px] uppercase tracking-wide text-treeline-dim">
        Pinned Files
      </div>
      <div className="max-h-44 overflow-y-auto">
        {state.paths.map((path) => {
          const missing = !!state.missing[path];
          const selected = state.selectedPath === path;
          const context = pinnedFileContext(path, roots);
          return (
            <div
              key={path}
              data-ss="pinned-file"
              data-ss-path={path}
              className={`group/pin flex min-w-0 items-center rounded px-1 py-0.5 ${
                selected ? 'bg-treeline-highlight' : 'hover:bg-treeline-highlight/60'
              }`}
            >
              <button
                type="button"
                onClick={() => void openPinnedFile(path)}
                disabled={missing}
                title={missing ? `${path} (file missing)` : path}
                className={`min-w-0 flex-1 px-1 text-left ${
                  missing ? 'cursor-default text-treeline-dim/60' : 'text-treeline-text'
                }`}
              >
                <span className={`block truncate text-xs ${missing ? 'line-through' : ''}`}>
                  {basename(path)}
                </span>
                <span className="block truncate text-[10px] text-treeline-dim">
                  {context}
                  {missing ? ' · File missing' : ''}
                </span>
              </button>
              <button
                type="button"
                onClick={() => toggleFilePin(path)}
                title="Unpin file"
                aria-label={`Unpin ${basename(path)}`}
                className="shrink-0 rounded px-1 text-treeline-yellow opacity-70 hover:bg-treeline-surface hover:opacity-100"
              >
                ★
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
