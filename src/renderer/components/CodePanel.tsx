import { useMemo, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { FileDiff } from '@shared/types';
import { buildFilePinRoots, containingFilePinRoot, type FilePinRoot } from '@shared/file-pins';
import type {
  OpenFileState,
  ViewerPane,
  ViewerPaneId,
  ViewerSplitDirection,
} from '../store/editor-slice';
import { useStore } from '../store';
import { basename, isMarkdownPath } from '../util/path';
import {
  activateOpenFile,
  closeViewerPane,
  openFileInSplit,
  saveOpenFile,
  setPanelMode,
  tryCloseCodePanel,
  tryCloseOpenFile,
  tryStopEditing,
  toggleFilePin,
} from '../actions/editor';
import { openNoteFromHistory } from '../actions/vault';
import { CodeMirrorView } from './CodeMirrorView';
import { DiffView } from './DiffView';
import { MarkdownView } from './MarkdownView';

/** Two-viewer file panel beside the terminal, with tabs shared across both viewers. */
export function CodePanel() {
  const s = useStore(
    useShallow((st) => ({
      openFilePaths: st.openFilePaths,
      activeFilePath: st.activeFilePath,
      openFilesByPath: st.openFilesByPath,
      viewerPanes: st.viewerPanes,
      focusedViewerPaneId: st.focusedViewerPaneId,
      viewerSplitDirection: st.viewerSplitDirection,
      viewerSplitRatio: st.viewerSplitRatio,
      setViewerSplitDirection: st.setViewerSplitDirection,
      setViewerSplitRatio: st.setViewerSplitRatio,
      startEditing: st.startEditing,
      setDraft: st.setDraft,
      focusViewerPane: st.focusViewerPane,
      noteHistoryByPane: st.noteHistoryByPane,
      pinnedFilePaths: st.pinnedFilePaths,
      repos: st.repos,
      folders: st.folders,
      worktreesByRepo: st.worktreesByRepo,
    })),
  );

  const filePinRoots = useMemo(
    () => buildFilePinRoots(s.repos, s.folders, s.worktreesByRepo),
    [s.folders, s.repos, s.worktreesByRepo],
  );

  return (
    <section className="flex h-full min-w-0 flex-col bg-treeline-surface">
      <FileTabStrip
        paths={s.openFilePaths}
        activePath={s.activeFilePath}
        files={s.openFilesByPath}
        panes={s.viewerPanes}
        direction={s.viewerSplitDirection}
        onDirectionChange={s.setViewerSplitDirection}
      />
      <ViewerSplit
        panes={s.viewerPanes}
        files={s.openFilesByPath}
        focusedPaneId={s.focusedViewerPaneId}
        direction={s.viewerSplitDirection}
        ratio={s.viewerSplitRatio}
        onRatioChange={s.setViewerSplitRatio}
        onFocus={s.focusViewerPane}
        histories={s.noteHistoryByPane}
        pinnedPaths={s.pinnedFilePaths}
        pinRoots={filePinRoots}
        onStartEditing={s.startEditing}
        onDraftChange={s.setDraft}
      />
    </section>
  );
}

function FileTabStrip({
  paths,
  activePath,
  files,
  panes,
  direction,
  onDirectionChange,
}: {
  paths: string[];
  activePath: string | null;
  files: Record<string, OpenFileState>;
  panes: ViewerPane[];
  direction: ViewerSplitDirection;
  onDirectionChange: (direction: ViewerSplitDirection) => void;
}) {
  if (paths.length === 0) return null;
  const duplicateNames = new Set(
    paths
      .map((path) => basename(path))
      .filter((name, index, names) => names.indexOf(name) !== index),
  );
  const visiblePaths = new Set(panes.map((pane) => pane.path));

  return (
    <div
      data-ss="file-tabs"
      className="flex h-8 shrink-0 items-end border-b border-treeline-highlight bg-treeline-surface"
    >
      <div
        role="tablist"
        aria-label="Open files"
        className="flex min-w-0 flex-1 items-end gap-px overflow-x-auto px-1 [scrollbar-width:none]"
      >
        {paths.map((path) => {
          const file = files[path];
          if (!file) return null;
          const active = path === activePath;
          const visible = visiblePaths.has(path);
          const dirty = file.editing && file.draft !== null && file.draft !== file.fileText;
          const slash = path.lastIndexOf('/');
          const parentPath = slash > 0 ? path.slice(0, slash) : '';
          const parent = basename(parentPath);
          const label = basename(path);
          return (
            <div
              key={path}
              role="tab"
              aria-selected={active}
              data-ss="file-tab"
              data-ss-path={path}
              className={`group/file-tab flex h-7 max-w-52 shrink-0 items-center rounded-t border-x border-t text-xs ${
                active
                  ? 'border-treeline-cyan/50 bg-treeline-highlight text-treeline-text'
                  : visible
                    ? 'border-treeline-highlight bg-treeline-highlight/50 text-treeline-text'
                    : 'border-transparent text-treeline-dim hover:text-treeline-text'
              }`}
              title={path}
            >
              <button
                type="button"
                onClick={() => activateOpenFile(path)}
                className="flex min-w-0 flex-1 items-center gap-1.5 py-1 pl-2"
              >
                {dirty && (
                  <span className="shrink-0 text-treeline-yellow" aria-label="Unsaved changes">
                    ●
                  </span>
                )}
                <span className="truncate">{label}</span>
                {duplicateNames.has(label) && parent && (
                  <span className="truncate text-[10px] text-treeline-dim">{parent}</span>
                )}
              </button>
              {!visible && panes.length > 0 && (
                <button
                  type="button"
                  onClick={() => openFileInSplit(path)}
                  aria-label={`Open ${label} in split`}
                  title={`Open ${label} in split`}
                  className="rounded px-1 text-treeline-dim opacity-0 hover:bg-treeline-surface hover:text-treeline-cyan group-hover/file-tab:opacity-100"
                >
                  ◫
                </button>
              )}
              <button
                type="button"
                onClick={() => tryCloseOpenFile(path)}
                aria-label={`Close ${label}`}
                title={`Close ${label}`}
                className="mr-1 rounded px-1 text-treeline-dim opacity-60 hover:bg-treeline-surface hover:text-treeline-red group-hover/file-tab:opacity-100"
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
      {panes.length === 2 && (
        <button
          type="button"
          onClick={() => onDirectionChange(direction === 'rows' ? 'columns' : 'rows')}
          title={
            direction === 'rows' ? 'Show viewers side by side' : 'Stack viewers top and bottom'
          }
          aria-label={
            direction === 'rows' ? 'Show viewers side by side' : 'Stack viewers top and bottom'
          }
          className="mb-0.5 shrink-0 rounded px-1.5 py-1 text-xs text-treeline-dim hover:bg-treeline-highlight hover:text-treeline-cyan"
        >
          {direction === 'rows' ? '↔' : '↕'}
        </button>
      )}
      <button
        type="button"
        onClick={tryCloseCodePanel}
        title="Hide code panel"
        aria-label="Hide code panel"
        className="mb-0.5 mr-1 shrink-0 rounded px-1.5 py-1 text-treeline-dim hover:bg-treeline-highlight hover:text-treeline-red"
      >
        ×
      </button>
    </div>
  );
}

function ViewerSplit({
  panes,
  files,
  focusedPaneId,
  direction,
  ratio,
  onRatioChange,
  onFocus,
  histories,
  pinnedPaths,
  pinRoots,
  onStartEditing,
  onDraftChange,
}: {
  panes: ViewerPane[];
  files: Record<string, OpenFileState>;
  focusedPaneId: ViewerPaneId;
  direction: ViewerSplitDirection;
  ratio: number;
  onRatioChange: (ratio: number) => void;
  onFocus: (paneId: ViewerPaneId) => void;
  histories: Record<ViewerPaneId, string[]>;
  pinnedPaths: string[];
  pinRoots: FilePinRoot[];
  onStartEditing: (path: string) => void;
  onDraftChange: (path: string, value: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  if (panes.length === 0) {
    return <Centered>Select a file in the sidebar to view it here.</Centered>;
  }

  const beginResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const move = (event: PointerEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const next =
        direction === 'rows'
          ? ((event.clientY - rect.top) / rect.height) * 100
          : ((event.clientX - rect.left) / rect.width) * 100;
      onRatioChange(next);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.style.userSelect = '';
    };
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div
      ref={containerRef}
      data-ss="viewer-split"
      data-ss-direction={direction}
      className={`flex min-h-0 min-w-0 flex-1 ${direction === 'rows' ? 'flex-col' : 'flex-row'}`}
    >
      {panes.map((pane, index) => {
        const file = files[pane.path];
        if (!file) return null;
        return (
          <div key={pane.id} className="contents">
            {index > 0 && (
              <div
                role="separator"
                aria-orientation={direction === 'rows' ? 'horizontal' : 'vertical'}
                onPointerDown={beginResize}
                className={
                  direction === 'rows'
                    ? 'h-1 shrink-0 cursor-row-resize bg-treeline-highlight hover:bg-treeline-cyan/60'
                    : 'w-1 shrink-0 cursor-col-resize bg-treeline-highlight hover:bg-treeline-cyan/60'
                }
              />
            )}
            <div
              className="min-h-0 min-w-0"
              style={
                panes.length === 2 && index === 0
                  ? { flexBasis: `${ratio}%`, flexGrow: 0, flexShrink: 0 }
                  : { flex: 1 }
              }
            >
              <FileViewerPane
                paneId={pane.id}
                file={file}
                focused={pane.id === focusedPaneId}
                split={panes.length === 2}
                history={histories[pane.id]}
                pinned={pinnedPaths.includes(file.path)}
                pinnable={containingFilePinRoot(file.path, pinRoots) !== null}
                onFocus={() => onFocus(pane.id)}
                onStartEditing={() => onStartEditing(file.path)}
                onDraftChange={(value) => onDraftChange(file.path, value)}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FileViewerPane({
  paneId,
  file,
  focused,
  split,
  history,
  pinned,
  pinnable,
  onFocus,
  onStartEditing,
  onDraftChange,
}: {
  paneId: ViewerPaneId;
  file: OpenFileState;
  focused: boolean;
  split: boolean;
  history: string[];
  pinned: boolean;
  pinnable: boolean;
  onFocus: () => void;
  onStartEditing: () => void;
  onDraftChange: (value: string) => void;
}) {
  const markdown = isMarkdownPath(file.path);
  const dirty = file.editing && file.draft !== null && file.draft !== file.fileText;
  const canEdit =
    file.panelMode === 'file' &&
    !file.fileLoading &&
    !file.fileError &&
    !file.fileBinary &&
    !file.fileTruncated &&
    file.fileText !== null;

  return (
    <section
      data-ss="viewer-pane"
      data-ss-pane={paneId}
      data-ss-path={file.path}
      onPointerDown={onFocus}
      className={`flex h-full min-h-0 min-w-0 flex-col bg-treeline-surface ${
        split && focused ? 'ring-1 ring-inset ring-treeline-cyan/50' : ''
      }`}
    >
      <header className="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-treeline-highlight px-2 py-1.5 [scrollbar-width:none]">
        <span
          className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-xs text-treeline-text"
          title={file.path}
        >
          {dirty && (
            <span
              className="shrink-0 text-treeline-yellow"
              title="Unsaved changes"
              aria-label="Unsaved changes"
            >
              ●
            </span>
          )}
          <span className="truncate">{basename(file.path)}</span>
        </span>

        {(pinned || pinnable) && (
          <button
            type="button"
            onClick={() => toggleFilePin(file.path)}
            title={pinned ? 'Unpin file' : 'Pin file'}
            aria-label={pinned ? 'Unpin file' : 'Pin file'}
            aria-pressed={pinned}
            className={`shrink-0 rounded px-1 hover:bg-treeline-highlight ${
              pinned ? 'text-treeline-yellow' : 'text-treeline-dim hover:text-treeline-text'
            }`}
          >
            {pinned ? '★' : '☆'}
          </button>
        )}

        {file.panelMode === 'file' && file.fileTruncated && (
          <span className="shrink-0 text-[10px] uppercase tracking-wide text-treeline-yellow">
            truncated
          </span>
        )}

        {file.editing ? (
          <div className="flex shrink-0 items-center gap-0.5">
            <HeaderButton
              label={file.saving ? 'Saving…' : 'Save'}
              onClick={() => void saveOpenFile(file.path)}
              disabled={!dirty || file.saving}
              accent
            />
            <HeaderButton label="Done" onClick={() => tryStopEditing(file.path)} />
          </div>
        ) : (
          canEdit && <HeaderButton label="Edit" onClick={onStartEditing} />
        )}

        <div className="flex shrink-0 items-center gap-0.5">
          {markdown && (
            <ModeTab
              label="Preview"
              active={file.panelMode === 'preview'}
              onClick={() => setPanelMode('preview', file.path)}
            />
          )}
          <ModeTab
            label="Diff"
            active={file.panelMode === 'diff'}
            onClick={() => setPanelMode('diff', file.path)}
          />
          <ModeTab
            label="File"
            active={file.panelMode === 'file'}
            onClick={() => setPanelMode('file', file.path)}
          />
        </div>

        {split && (
          <button
            type="button"
            onClick={() => closeViewerPane(paneId)}
            title="Close this viewer"
            aria-label="Close this viewer"
            className="shrink-0 rounded px-1 text-treeline-dim hover:bg-treeline-highlight hover:text-treeline-red"
          >
            ⊟
          </button>
        )}
      </header>

      {history.length > 0 && (
        <NoteBreadcrumbs paneId={paneId} history={history} currentPath={file.path} />
      )}

      {file.saveError && (
        <div className="shrink-0 border-b border-treeline-highlight bg-treeline-red/10 px-3 py-1 text-xs text-treeline-red">
          Save failed: {file.saveError}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-hidden">
        {file.panelMode === 'diff' ? (
          <DiffBody loading={file.diffLoading} error={file.diffError} diff={file.diff} />
        ) : file.panelMode === 'preview' ? (
          <MarkdownBody
            paneId={paneId}
            loading={file.fileLoading}
            error={file.fileError}
            binary={file.fileBinary}
            source={file.fileText}
            filePath={file.path}
          />
        ) : (
          <FileBody
            loading={file.fileLoading}
            error={file.fileError}
            binary={file.fileBinary}
            editing={file.editing}
            text={file.editing ? (file.draft ?? '') : file.fileText}
            filename={basename(file.path)}
            onChange={onDraftChange}
            onSave={() => void saveOpenFile(file.path)}
            revealLine={file.revealLine}
            revealTick={file.revealTick}
          />
        )}
      </div>
    </section>
  );
}

function crumbLabel(path: string): string {
  return basename(path).replace(/\.(md|markdown)$/i, '');
}

function NoteBreadcrumbs({
  paneId,
  history,
  currentPath,
}: {
  paneId: ViewerPaneId;
  history: string[];
  currentPath: string;
}) {
  return (
    <nav
      data-ss="note-breadcrumbs"
      aria-label="Note navigation history"
      className="flex shrink-0 items-center gap-1 overflow-x-auto whitespace-nowrap border-b border-treeline-highlight px-3 py-1 text-[10px] [scrollbar-width:none]"
    >
      <button
        type="button"
        data-ss="note-back"
        onClick={() => void openNoteFromHistory(paneId, history.length - 1)}
        title={`Back to ${crumbLabel(history[history.length - 1])}`}
        aria-label="Back to previous note"
        className="shrink-0 rounded px-1 font-semibold text-treeline-dim hover:bg-treeline-highlight hover:text-treeline-text"
      >
        ←
      </button>
      {history.map((path, i) => (
        <span key={`${i}-${path}`} className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            data-ss="note-crumb"
            onClick={() => void openNoteFromHistory(paneId, i)}
            title={path}
            className="max-w-40 truncate rounded px-1 text-treeline-dim hover:bg-treeline-highlight hover:text-treeline-text"
          >
            {crumbLabel(path)}
          </button>
          <span className="text-treeline-dim/60">›</span>
        </span>
      ))}
      <span className="max-w-40 truncate px-1 text-treeline-text" title={currentPath}>
        {crumbLabel(currentPath)}
      </span>
    </nav>
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
  onSave,
  revealLine,
  revealTick,
}: {
  loading: boolean;
  error: string | null;
  binary: boolean;
  editing: boolean;
  text: string | null;
  filename: string;
  onChange: (value: string) => void;
  onSave: () => void;
  revealLine: number | null;
  revealTick: number;
}) {
  if (loading) return <Centered>Loading…</Centered>;
  if (error) return <Centered tone="error">{error}</Centered>;
  if (binary) return <Centered>Binary file — can&apos;t display.</Centered>;
  if (text === null) return null;
  return (
    <CodeMirrorView
      value={text}
      filename={filename}
      editable={editing}
      onChange={editing ? onChange : undefined}
      onSave={editing ? onSave : undefined}
      revealLine={revealLine}
      revealTick={revealTick}
    />
  );
}

function MarkdownBody({
  paneId,
  loading,
  error,
  binary,
  source,
  filePath,
}: {
  paneId: ViewerPaneId;
  loading: boolean;
  error: string | null;
  binary: boolean;
  source: string | null;
  filePath: string;
}) {
  if (loading) return <Centered>Loading…</Centered>;
  if (error) return <Centered tone="error">{error}</Centered>;
  if (binary) return <Centered>Binary file — can&apos;t display.</Centered>;
  if (source === null) return null;
  return <MarkdownView paneId={paneId} source={source} filePath={filePath} />;
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
  if (diff.lines.length === 0) return <Centered>No changes vs the last commit.</Centered>;
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
