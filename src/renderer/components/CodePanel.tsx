import { useShallow } from 'zustand/react/shallow';
import type { FileDiff } from '@shared/types';
import { useStore } from '../store';
import { basename, isMarkdownPath } from '../util/path';
import {
  saveOpenFile,
  setPanelMode,
  tryCloseCodePanel,
  tryStopEditing,
} from '../actions/editor';
import { CodeMirrorView } from './CodeMirrorView';
import { DiffView } from './DiffView';
import { MarkdownView } from './MarkdownView';

/**
 * The split code-viewer panel beside the terminal. Shows the open file as its
 * full contents or a unified diff (working tree vs HEAD), switchable via the
 * Diff | File toggle. The File view is read-only until you hit Edit, then ⌘S /
 * Save writes to disk.
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
      editing: st.editing,
      draft: st.draft,
      saving: st.saving,
      saveError: st.saveError,
      startEditing: st.startEditing,
      setDraft: st.setDraft,
    })),
  );

  const isMarkdown = s.openFilePath !== null && isMarkdownPath(s.openFilePath);
  const dirty = s.editing && s.draft !== null && s.draft !== s.openFileText;
  // Editable only for a fully-loaded, non-binary, non-truncated text file.
  const canEdit =
    s.panelMode === 'file' &&
    !s.openFileLoading &&
    !s.openFileError &&
    !s.openFileBinary &&
    !s.openFileTruncated &&
    s.openFileText !== null;

  return (
    <section className="flex h-full min-w-0 flex-col bg-treeline-surface">
      <header className="flex shrink-0 items-center gap-2 border-b border-treeline-highlight px-3 py-1.5">
        <span
          className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-xs text-treeline-text"
          title={s.openFilePath ?? undefined}
        >
          {dirty && (
            <span className="shrink-0 text-treeline-yellow" title="Unsaved changes" aria-label="Unsaved changes">
              ●
            </span>
          )}
          <span className="truncate">{s.openFilePath ? basename(s.openFilePath) : 'Code'}</span>
        </span>

        {s.panelMode === 'file' && s.openFileTruncated && (
          <span
            className="shrink-0 text-[10px] uppercase tracking-wide text-treeline-yellow"
            title="File exceeds the 1 MB view cap; read-only."
          >
            truncated
          </span>
        )}

        {/* Edit controls (File view only). */}
        {s.editing ? (
          <div className="flex shrink-0 items-center gap-0.5">
            <HeaderButton
              label={s.saving ? 'Saving…' : 'Save'}
              onClick={() => void saveOpenFile()}
              disabled={!dirty || s.saving}
              accent
            />
            <HeaderButton label="Done" onClick={tryStopEditing} />
          </div>
        ) : (
          canEdit && <HeaderButton label="Edit" onClick={s.startEditing} />
        )}

        {s.openFilePath && (
          <div className="flex shrink-0 items-center gap-0.5">
            {isMarkdown && (
              <ModeTab
                label="Preview"
                active={s.panelMode === 'preview'}
                onClick={() => setPanelMode('preview')}
              />
            )}
            <ModeTab label="Diff" active={s.panelMode === 'diff'} onClick={() => setPanelMode('diff')} />
            <ModeTab label="File" active={s.panelMode === 'file'} onClick={() => setPanelMode('file')} />
          </div>
        )}

        <button
          type="button"
          onClick={tryCloseCodePanel}
          title="Close code panel"
          aria-label="Close code panel"
          className="shrink-0 rounded px-1 text-treeline-dim hover:bg-treeline-highlight hover:text-treeline-red"
        >
          ×
        </button>
      </header>

      {s.saveError && (
        <div className="shrink-0 border-b border-treeline-highlight bg-treeline-red/10 px-3 py-1 text-xs text-treeline-red">
          Save failed: {s.saveError}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-hidden">
        {s.openFilePath === null ? (
          <Centered>Select a file in the sidebar to view it here.</Centered>
        ) : s.panelMode === 'diff' ? (
          <DiffBody loading={s.diffLoading} error={s.diffError} diff={s.openDiff} />
        ) : s.panelMode === 'preview' ? (
          <MarkdownBody
            loading={s.openFileLoading}
            error={s.openFileError}
            binary={s.openFileBinary}
            source={s.openFileText}
          />
        ) : (
          <FileBody
            loading={s.openFileLoading}
            error={s.openFileError}
            binary={s.openFileBinary}
            editing={s.editing}
            text={s.editing ? (s.draft ?? '') : s.openFileText}
            filename={basename(s.openFilePath)}
            onChange={s.setDraft}
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
  editing,
  text,
  filename,
  onChange,
}: {
  loading: boolean;
  error: string | null;
  binary: boolean;
  editing: boolean;
  text: string | null;
  filename: string;
  onChange: (value: string) => void;
}) {
  if (loading) return <Centered>Loading…</Centered>;
  if (error) return <Centered tone="error">{error}</Centered>;
  if (binary) return <Centered>Binary file — can&apos;t display.</Centered>;
  if (text !== null) {
    return (
      <CodeMirrorView
        value={text}
        filename={filename}
        editable={editing}
        onChange={editing ? onChange : undefined}
        onSave={editing ? () => void saveOpenFile() : undefined}
      />
    );
  }
  return null;
}

function MarkdownBody({
  loading,
  error,
  binary,
  source,
}: {
  loading: boolean;
  error: string | null;
  binary: boolean;
  source: string | null;
}) {
  if (loading) return <Centered>Loading…</Centered>;
  if (error) return <Centered tone="error">{error}</Centered>;
  if (binary) return <Centered>Binary file — can&apos;t display.</Centered>;
  if (source !== null) return <MarkdownView source={source} />;
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

function HeaderButton({
  label,
  onClick,
  disabled,
  accent,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  accent?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded px-1.5 py-0.5 text-[10px] disabled:opacity-40 ${
        accent
          ? 'text-treeline-cyan hover:bg-treeline-highlight'
          : 'text-treeline-dim hover:bg-treeline-highlight hover:text-treeline-text'
      }`}
    >
      {label}
    </button>
  );
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
