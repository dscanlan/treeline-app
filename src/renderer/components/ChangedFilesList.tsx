import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { ChangedFile, ChangedFileStatus } from '@shared/types';
import { useStore } from '../store';
import { openDiffInPanel, refreshChangedFiles } from '../actions/editor';
import { startChangedFilesPoll } from '../changed-poll';

/** Status letter + color per change category, echoing the dirty-dot palette. */
const STATUS_META: Record<ChangedFileStatus, { letter: string; className: string; title: string }> =
  {
    modified: { letter: 'M', className: 'text-treeline-yellow', title: 'Modified' },
    added: { letter: 'A', className: 'text-treeline-green', title: 'Added' },
    untracked: { letter: '?', className: 'text-treeline-green', title: 'Untracked' },
    deleted: { letter: 'D', className: 'text-treeline-red', title: 'Deleted' },
    renamed: { letter: 'R', className: 'text-treeline-cyan', title: 'Renamed' },
    conflicted: { letter: 'U', className: 'text-treeline-red', title: 'Conflicted' },
  };

/**
 * Flat list of a worktree's working-tree changes (the Changed view). Clicking a
 * file opens it in the code panel, just like the tree. Deleted files are shown
 * but not clickable — there's nothing on disk to read.
 */
export function ChangedFilesList({ worktreePath }: { worktreePath: string }) {
  const { files, loading, openFilePath } = useStore(
    useShallow((s) => ({
      files: s.changedByWorktree[worktreePath],
      loading: s.changedLoading[worktreePath],
      openFilePath: s.openFilePath,
    })),
  );

  // This view is mounted only while it's open and its worktree row is expanded,
  // so a local interval keeps the list live without any global timer. The poll
  // logic lives in changed-poll.ts so it can be unit-tested without a DOM.
  useEffect(
    () =>
      startChangedFilesPoll(worktreePath, {
        refresh: refreshChangedFiles,
        isVisible: () => document.visibilityState === 'visible',
      }),
    [worktreePath],
  );

  if (files === undefined) {
    return <LeafText>{loading ? 'loading…' : ''}</LeafText>;
  }
  if (files.length === 0) {
    return <LeafText>No changes</LeafText>;
  }
  return (
    <>
      {files.map((file) => (
        <ChangedRow key={file.path} file={file} selected={openFilePath === file.path} />
      ))}
    </>
  );
}

function ChangedRow({ file, selected }: { file: ChangedFile; selected: boolean }) {
  const meta = STATUS_META[file.status];
  const deleted = file.status === 'deleted';

  const inner = (
    <>
      <span className={`w-3 shrink-0 text-center text-[11px] font-medium ${meta.className}`}>
        {meta.letter}
      </span>
      <span className={`truncate ${deleted ? 'line-through' : ''}`}>{file.relPath}</span>
    </>
  );

  if (deleted) {
    return (
      <div
        title={`${meta.title} — ${file.relPath}`}
        className="flex items-center gap-1.5 py-0.5 pl-6 pr-2 text-treeline-dim"
      >
        {inner}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void openDiffInPanel(file.path)}
      title={`${meta.title} — ${file.relPath}`}
      className={`flex w-full items-center gap-1.5 py-0.5 pl-6 pr-2 text-left ${
        selected
          ? 'bg-treeline-highlight text-treeline-text'
          : 'text-treeline-dim hover:bg-treeline-highlight/60 hover:text-treeline-text'
      }`}
    >
      {inner}
    </button>
  );
}

function LeafText({ children }: { children: React.ReactNode }) {
  return <div className="py-0.5 pl-8 text-xs italic text-treeline-dim">{children}</div>;
}
