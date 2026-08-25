// Code-viewer orchestration: open a file in the side panel, lazily expand
// directories in the file tree, and drive the All|Changed view. Keeps the IPC
// dance out of the components, mirroring actions/tabs.ts.
import type { PanelMode, ViewerPaneId, WorktreeFileView } from '../store/editor-slice';
import type { DiscardThen } from '../store/modal-slice';
import type { NoteHistoryBehavior } from '../store/vault-slice';
import { useStore } from '../store';
import { basename, isMarkdownPath } from '../util/path';

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** True when a file tab has changes not yet written to disk. */
export function hasUnsavedEdits(path = useStore.getState().activeFilePath): boolean {
  if (!path) return false;
  const s = useStore.getState();
  const file = s.openFilesByPath[path];
  return !!file && file.editing && file.draft !== null && file.draft !== file.fileText;
}

/**
 * If there are unsaved edits, open the discard-confirmation modal (deferring
 * `then` until the user confirms) and return false to abort the caller. With no
 * unsaved edits, return true so the caller proceeds immediately.
 */
function guardUnsaved(path: string, then: DiscardThen): boolean {
  if (!hasUnsavedEdits(path)) return true;
  useStore.getState().openModal({
    kind: 'confirm-discard',
    filename: basename(path),
    then,
  });
  return false;
}

/** Keep the surviving viewer's breadcrumb trail when a primary pane is promoted. */
function prepareHistoryForViewerRemoval(paneId: ViewerPaneId): void {
  const s = useStore.getState();
  if (s.viewerPanes.length === 2 && paneId === 'primary') {
    const survivingHistory = [...s.noteHistoryByPane.secondary];
    s.clearAllNoteHistories();
    for (const path of survivingHistory) s.pushNoteHistory('primary', path);
  } else {
    s.clearNoteHistory(paneId);
  }
}

/**
 * Run a deferred discard action after the user confirms in the modal: drop the
 * draft, close the modal, then perform the pending navigation.
 */
export function confirmDiscardAndContinue(then: DiscardThen): void {
  const s = useStore.getState();
  s.closeModal();
  switch (then.type) {
    case 'close-file':
      {
        const pane = s.viewerPanes.find((candidate) => candidate.path === then.path);
        if (pane) prepareHistoryForViewerRemoval(pane.id);
      }
      s.stopEditing(then.path);
      s.closeOpenFile(then.path);
      break;
    case 'stop-editing':
      s.stopEditing(then.path);
      break;
  }
}

/**
 * Apply an open's effect on the note-navigation breadcrumbs. Runs after the
 * unsaved-edits guard passes, so a cancelled navigation never touches the
 * trail. `push` records the file being left; everything else ends (or, for a
 * back-jump, truncates) the trail — see NoteHistoryBehavior.
 */
function applyNoteHistory(
  behavior: NoteHistoryBehavior,
  openingPath: string,
  paneId: ViewerPaneId,
): void {
  const s = useStore.getState();
  if (behavior === 'push') {
    const prev = s.viewerPanes.find((pane) => pane.id === paneId)?.path;
    if (prev && prev !== openingPath) s.pushNoteHistory(paneId, prev);
  } else if (behavior === 'clear') {
    s.clearNoteHistory(paneId);
  } else {
    s.truncateNoteHistory(paneId, behavior.truncateTo);
  }
}

/**
 * Load a file into the panel (no unsaved-edits guard). Markdown lands on the
 * rendered Preview by default; everything else opens as raw source. Both modes
 * read the same file text.
 */
async function doOpenFile(
  path: string,
  history: NoteHistoryBehavior = 'clear',
  paneId = useStore.getState().focusedViewerPaneId,
): Promise<void> {
  const beforeOpen = useStore.getState();
  const visibleInOtherPane = beforeOpen.viewerPanes.some(
    (pane) => pane.path === path && pane.id !== paneId,
  );
  // A document remains unique across viewers. If a link targets the file that
  // is already visible opposite, focus that viewer without creating a bogus
  // history entry in the source viewer.
  if (!visibleInOtherPane) applyNoteHistory(history, path, paneId);
  const mode = isMarkdownPath(path) ? 'preview' : 'file';
  const existing = beforeOpen.openFilesByPath[path];
  const dirty = existing
    ? existing.editing && existing.draft !== null && existing.draft !== existing.fileText
    : false;
  useStore.getState().openInPanel(path, mode, paneId);
  // A direct open doubles as refresh for a clean tab, which matters when an
  // agent changed the file on disk. Never replace a dirty in-memory draft.
  if (!dirty) await loadFileContent(path);
}

/** Load a file into the panel as a diff (no unsaved-edits guard). */
async function doOpenDiff(
  path: string,
  paneId = useStore.getState().focusedViewerPaneId,
): Promise<void> {
  useStore.getState().clearNoteHistory(paneId);
  useStore.getState().openInPanel(path, 'diff', paneId);
  await loadFileDiff(path);
}

/** Longest worktree path containing `filePath`, or null if untracked. */
function worktreePathFor(filePath: string): string | null {
  const { worktreesByRepo } = useStore.getState();
  let best: string | null = null;
  for (const wts of Object.values(worktreesByRepo)) {
    for (const wt of wts) {
      const inside = filePath === wt.path || filePath.startsWith(`${wt.path}/`);
      if (inside && (best === null || wt.path.length > best.length)) best = wt.path;
    }
  }
  return best;
}

/** Fetch the full-file representation for `path` into the panel. */
async function loadFileContent(path: string): Promise<void> {
  const requestId = useStore.getState().beginFileLoad(path);
  if (requestId === 0) return;
  try {
    const result = await window.treeline.files.read(path);
    useStore.getState().applyFileResult(result, requestId);
  } catch (err) {
    useStore.getState().setFileError(path, requestId, errMsg(err));
  }
}

/** Fetch the diff representation for `path` into the panel. */
async function loadFileDiff(path: string): Promise<void> {
  const requestId = useStore.getState().beginDiffLoad(path);
  if (requestId === 0) return;
  try {
    const diff = await window.treeline.files.diff(path);
    useStore.getState().applyDiffResult(diff, requestId);
  } catch (err) {
    useStore.getState().setDiffError(path, requestId, errMsg(err));
  }
}

/**
 * Open a file in the panel showing its full contents. Used by the tree,
 * quick-open, and (with a non-default `history`) the notes reader's link and
 * back/breadcrumb navigation.
 */
export async function openFileInPanel(
  path: string,
  opts?: { history?: NoteHistoryBehavior; paneId?: ViewerPaneId },
): Promise<void> {
  const history = opts?.history ?? 'clear';
  await doOpenFile(path, history, opts?.paneId);
}

/** Pin/unpin a browsed file and immediately refresh its availability if added. */
export function toggleFilePin(path: string): void {
  const s = useStore.getState();
  const wasPinned = s.pinnedFilePaths.includes(path);
  s.togglePinnedFile(path);
  if (!wasPinned) void refreshPinnedFileAvailability(path);
}

/** Refresh one pin's last-known on-disk status using the existing system bridge. */
export async function refreshPinnedFileAvailability(path: string): Promise<boolean | null> {
  try {
    const exists = await window.treeline.system.pathExists(path);
    // Ignore a late response for a pin that was removed while the IPC was in flight.
    if (useStore.getState().pinnedFilePaths.includes(path)) {
      useStore.getState().setPinnedFileMissing(path, !exists);
    }
    return exists;
  } catch {
    return null;
  }
}

/** Best-effort async availability refresh for all restored pins. */
export async function refreshPinnedFilesAvailability(): Promise<void> {
  const paths = useStore.getState().pinnedFilePaths;
  await Promise.all(paths.map(refreshPinnedFileAvailability));
}

/** Revalidate a global pin before opening; confirmed-missing rows remain inert. */
export async function openPinnedFile(path: string): Promise<void> {
  const exists = await refreshPinnedFileAvailability(path);
  if (exists === false) return;
  await openFileInPanel(path);
}

/**
 * Open `path` and scroll to + highlight `line` (1-based) — the action behind a
 * find-in-files result click. Forces raw 'file' mode (not markdown Preview) so
 * the matched line is actually navigable, then sets the reveal target the
 * CodeMirror view consumes once the text loads.
 */
export async function openFileAtLine(path: string, line: number): Promise<void> {
  const paneId = useStore.getState().focusedViewerPaneId;
  useStore.getState().clearNoteHistory(paneId);
  const dirty = hasUnsavedEdits(path);
  useStore.getState().openInPanel(path, 'file', paneId);
  if (!dirty) await loadFileContent(path);
  useStore.getState().setRevealLine(path, line);
}

/** Open a file in the panel showing its diff (used by the Changed list). */
export async function openDiffInPanel(path: string): Promise<void> {
  await doOpenDiff(path);
}

/** Activate an existing file tab without re-reading it. */
export function activateOpenFile(path: string): void {
  const s = useStore.getState();
  const paneId = s.viewerPanes.find((pane) => pane.path === path)?.id ?? s.focusedViewerPaneId;
  s.clearNoteHistory(paneId);
  s.activateOpenFile(path);
}

/** Display an existing file tab in the other viewer, creating the split when needed. */
export function openFileInSplit(path: string): void {
  const s = useStore.getState();
  const visible = s.viewerPanes.find((pane) => pane.path === path);
  const paneId =
    visible?.id ??
    (s.viewerPanes.length < 2
      ? 'secondary'
      : s.focusedViewerPaneId === 'primary'
        ? 'secondary'
        : 'primary');
  s.clearNoteHistory(paneId);
  s.openFileInSplit(path);
}

/** Collapse a two-viewer split without closing either file tab. */
export function closeViewerPane(paneId: ViewerPaneId): void {
  const s = useStore.getState();
  prepareHistoryForViewerRemoval(paneId);
  s.closeViewerPane(paneId);
}

/** Close one tab, warning only when that tab owns an unsaved draft. */
export function tryCloseOpenFile(path: string): void {
  if (!guardUnsaved(path, { type: 'close-file', path })) return;
  const s = useStore.getState();
  const pane = s.viewerPanes.find((candidate) => candidate.path === path);
  if (pane) prepareHistoryForViewerRemoval(pane.id);
  s.closeOpenFile(path);
}

/** Hide the panel. Tabs and drafts stay in memory and reopen on the next file click. */
export function tryCloseCodePanel(): void {
  const s = useStore.getState();
  s.clearAllNoteHistories();
  s.closeCodePanel();
}

/** Leave edit mode (back to read-only), warning first if there are unsaved edits. */
export function tryStopEditing(path = useStore.getState().activeFilePath): void {
  if (!path || !guardUnsaved(path, { type: 'stop-editing', path })) return;
  useStore.getState().stopEditing(path);
}

/** Save the open file's draft to disk (⌘S / Save button). */
export async function saveOpenFile(path = useStore.getState().activeFilePath): Promise<void> {
  const s = useStore.getState();
  if (!path) return;
  const file = s.openFilesByPath[path];
  if (!file?.editing || file.draft === null || file.draft === file.fileText) return;
  const content = file.draft;

  s.setSaving(path, true);
  try {
    await window.treeline.files.write(path, content);
    useStore.getState().applySaved(path, content);
    // The on-disk file changed — refresh the cached diff (if loaded) and the
    // containing worktree's Changed list so both reflect the save.
    if (useStore.getState().openFilesByPath[path]?.diff !== null) void loadFileDiff(path);
    const wtPath = worktreePathFor(path);
    if (wtPath) void refreshChangedFiles(wtPath);
  } catch (err) {
    useStore.getState().setSaveError(path, errMsg(err));
  }
}

/**
 * Flip the open file between File and Diff in the panel header, lazily fetching
 * the other representation the first time it's needed.
 */
export function setPanelMode(mode: PanelMode, path = useStore.getState().activeFilePath): void {
  const s = useStore.getState();
  if (!path) return;
  const file = s.openFilesByPath[path];
  if (!file) return;
  s.setPanelMode(path, mode);
  // File and Preview both render the file's text; load it on first need.
  const needsFileText = mode === 'file' || mode === 'preview';
  if (needsFileText && file.fileText === null && file.fileError === null && !file.fileLoading) {
    void loadFileContent(path);
  }
  if (mode === 'diff' && file.diff === null && file.diffError === null && !file.diffLoading) {
    void loadFileDiff(path);
  }
}

/**
 * Toggle a directory node in the tree. Every expand (re-)reads the directory so
 * files added since the last listing show up — the All tree has no fs watcher,
 * so a stale cache would otherwise hide new entries forever. Cached children
 * stay rendered while the fresh read is in flight (no "loading…" flash); a cold
 * expand shows the placeholder until the first read lands.
 */
export async function toggleDir(path: string): Promise<void> {
  const s = useStore.getState();
  const willExpand = !s.expandedDirs[path];
  s.setDirExpanded(path, willExpand);
  if (!willExpand) return;
  try {
    const entries = await window.treeline.files.readDir(path);
    useStore.getState().setDirChildren(path, entries);
  } catch {
    // Only a cold expand (nothing cached) falls back to empty; a failed refresh
    // keeps the previously-listed children rather than blanking the row.
    if (useStore.getState().dirChildren[path] === undefined) {
      useStore.getState().setDirChildren(path, []);
    }
  }
}

/**
 * Worktrees with a `files.changed` fetch currently in flight. On a big tree a
 * single `git status` can take many seconds; the 2.5s poll would otherwise
 * stack up overlapping calls (each spawning its own git), which only makes the
 * tree slower. Skip a tick while one is already running for that worktree.
 */
const changedInFlight = new Set<string>();

/** Fetch (or re-fetch) a worktree's working-tree changes into the store. */
export async function refreshChangedFiles(worktreePath: string): Promise<void> {
  if (changedInFlight.has(worktreePath)) return;
  changedInFlight.add(worktreePath);

  const s = useStore.getState();
  // Only show the spinner on a cold load; background refreshes stay silent.
  if (s.changedByWorktree[worktreePath] === undefined) {
    s.setChangedLoading(worktreePath, true);
  }
  try {
    const files = await window.treeline.files.changed(worktreePath);
    useStore.getState().setChangedFiles(worktreePath, files);
  } catch {
    // A transient failure (a timed-out `git status`, locked git, a
    // momentarily-unavailable path) must not blank an already-populated list —
    // that's the "list disappeared" bug. Only fall back to empty on a cold load
    // where there's nothing to preserve.
    const current = useStore.getState().changedByWorktree[worktreePath];
    if (current === undefined) {
      useStore.getState().setChangedFiles(worktreePath, []);
    } else {
      useStore.getState().setChangedLoading(worktreePath, false);
    }
  } finally {
    changedInFlight.delete(worktreePath);
  }
}

/**
 * Switch a worktree's file area between All and Changed. Entering Changed
 * fetches the list (cached results show immediately, then refresh).
 */
export function setWorktreeFileView(worktreePath: string, view: WorktreeFileView): void {
  useStore.getState().setWorktreeFileView(worktreePath, view);
  if (view === 'changed') void refreshChangedFiles(worktreePath);
}
