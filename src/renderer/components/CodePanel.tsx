import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../store';
import { basename } from '../util/path';
import { CodeMirrorView } from './CodeMirrorView';

/**
 * The split code-viewer panel that sits beside the terminal in MainArea. Shows
 * the file currently loaded into the editor slice, with loading / error /
 * binary / truncated states. Read-only in phase 1.
 */
export function CodePanel() {
  const {
    openFilePath,
    openFileText,
    openFileTruncated,
    openFileBinary,
    openFileError,
    openFileLoading,
    closeCodePanel,
  } = useStore(
    useShallow((s) => ({
      openFilePath: s.openFilePath,
      openFileText: s.openFileText,
      openFileTruncated: s.openFileTruncated,
      openFileBinary: s.openFileBinary,
      openFileError: s.openFileError,
      openFileLoading: s.openFileLoading,
      closeCodePanel: s.closeCodePanel,
    })),
  );

  return (
    <section className="flex h-full min-w-0 flex-col bg-treeline-surface">
      <header className="flex shrink-0 items-center gap-2 border-b border-treeline-highlight px-3 py-1.5">
        <span
          className="min-w-0 flex-1 truncate text-xs text-treeline-text"
          title={openFilePath ?? undefined}
        >
          {openFilePath ? basename(openFilePath) : 'Code'}
        </span>
        {openFileTruncated && (
          <span
            className="shrink-0 text-[10px] uppercase tracking-wide text-treeline-yellow"
            title="File exceeds the 1 MB view cap; showing the start only."
          >
            truncated
          </span>
        )}
        <button
          type="button"
          onClick={closeCodePanel}
          title="Close code panel"
          aria-label="Close code panel"
          className="shrink-0 rounded px-1 text-treeline-dim hover:bg-treeline-highlight hover:text-treeline-red"
        >
          ×
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden">
        {openFilePath === null ? (
          <Centered>Select a file in the sidebar to view it here.</Centered>
        ) : openFileLoading ? (
          <Centered>Loading…</Centered>
        ) : openFileError ? (
          <Centered tone="error">{openFileError}</Centered>
        ) : openFileBinary ? (
          <Centered>Binary file — can&apos;t display.</Centered>
        ) : openFileText !== null ? (
          <CodeMirrorView value={openFileText} filename={basename(openFilePath)} />
        ) : null}
      </div>
    </section>
  );
}

function Centered({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: 'error';
}) {
  return (
    <div className="flex h-full items-center justify-center px-4 text-center text-sm">
      <span className={tone === 'error' ? 'text-treeline-red' : 'text-treeline-dim'}>
        {children}
      </span>
    </div>
  );
}
