import { useShallow } from 'zustand/react/shallow';
import type { FileDiff } from '@shared/types';
import { useStore } from '../store';
import { basename } from '../util/path';
import { setPanelMode } from '../actions/editor';
import { CodeMirrorView } from './CodeMirrorView';
import { DiffView } from './DiffView';

/**
 * The split code-viewer panel beside the terminal. Shows the open file either
 * as its full contents or as a unified diff (working tree vs HEAD), switchable
 * via the Diff | File toggle. Read-only.
 */
export function CodePanel() {
  const s = useStore(
    useShallow((st) => ({
      openFilePath: st.openFilePath,
      panelMode: st.panelMode,
      openFileText: st.openFileText,
      openFileTruncated: st.openFileTruncated,
      openFileBinary: st.openFileBinary,
      openFileError: st.openFileError,
      openFileLoading: st.openFileLoading,
      openDiff: st.openDiff,
      diffError: st.diffError,
      diffLoading: st.diffLoading,
      closeCodePanel: st.closeCodePanel,
    })),
  );

  return (
    <section className="flex h-full min-w-0 flex-col bg-treeline-surface">
      <header className="flex shrink-0 items-center gap-2 border-b border-treeline-highlight px-3 py-1.5">
        <span
          className="min-w-0 flex-1 truncate text-xs text-treeline-text"
          title={s.openFilePath ?? undefined}
        >
          {s.openFilePath ? basename(s.openFilePath) : 'Code'}
        </span>
        {s.panelMode === 'file' && s.openFileTruncated && (
          <span
            className="shrink-0 text-[10px] uppercase tracking-wide text-treeline-yellow"
            title="File exceeds the 1 MB view cap; showing the start only."
          >
            truncated
          </span>
        )}
        {s.openFilePath && (
          <div className="flex shrink-0 items-center gap-0.5">
            <ModeTab label="Diff" active={s.panelMode === 'diff'} onClick={() => setPanelMode('diff')} />
            <ModeTab label="File" active={s.panelMode === 'file'} onClick={() => setPanelMode('file')} />
          </div>
        )}
        <button
          type="button"
          onClick={s.closeCodePanel}
          title="Close code panel"
          aria-label="Close code panel"
          className="shrink-0 rounded px-1 text-treeline-dim hover:bg-treeline-highlight hover:text-treeline-red"
        >
          ×
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden">
        {s.openFilePath === null ? (
          <Centered>Select a file in the sidebar to view it here.</Centered>
        ) : s.panelMode === 'diff' ? (
          <DiffBody
            loading={s.diffLoading}
            error={s.diffError}
            diff={s.openDiff}
          />
        ) : (
          <FileBody
            loading={s.openFileLoading}
            error={s.openFileError}
            binary={s.openFileBinary}
            text={s.openFileText}
            filename={basename(s.openFilePath)}
          />
        )}
      </div>
    </section>
  );
}

function FileBody({
  loading,
  error,
  binary,
  text,
  filename,
}: {
  loading: boolean;
  error: string | null;
  binary: boolean;
  text: string | null;
  filename: string;
}) {
  if (loading) return <Centered>Loading…</Centered>;
  if (error) return <Centered tone="error">{error}</Centered>;
  if (binary) return <Centered>Binary file — can&apos;t display.</Centered>;
  if (text !== null) return <CodeMirrorView value={text} filename={filename} />;
  return null;
}

function DiffBody({
  loading,
  error,
  diff,
}: {
  loading: boolean;
  error: string | null;
  diff: FileDiff | null;
}) {
  if (loading) return <Centered>Loading diff…</Centered>;
  if (error) return <Centered tone="error">{error}</Centered>;
  if (!diff) return null;
  if (diff.binary) return <Centered>Binary file — no diff to show.</Centered>;
  if (diff.lines.length === 0) {
    return <Centered>No changes vs the last commit.</Centered>;
  }
  return <DiffView diff={diff} />;
}

function ModeTab({
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
      className={`rounded px-1.5 py-0.5 text-[10px] ${
        active
          ? 'bg-treeline-highlight text-treeline-text'
          : 'text-treeline-dim hover:text-treeline-text'
      }`}
    >
      {label}
    </button>
  );
}

function Centered({ children, tone }: { children: React.ReactNode; tone?: 'error' }) {
  return (
    <div className="flex h-full items-center justify-center px-4 text-center text-sm">
      <span className={tone === 'error' ? 'text-treeline-red' : 'text-treeline-dim'}>
        {children}
      </span>
    </div>
  );
}
