// Code-viewer orchestration: open a file in the side panel, lazily expand
// directories in the file tree, and drive the All|Changed view. Keeps the IPC
// dance out of the components, mirroring actions/tabs.ts.
import type { PanelMode, WorktreeFileView } from '../store/editor-slice';
import type { DiscardThen } from '../store/modal-slice';
import type { NoteHistoryBehavior } from '../store/vault-slice';
import { useStore } from '../store';
import { basename, isMarkdownPath } from '../util/path';

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** True when edit mode has changes not yet written to disk. */
export function hasUnsavedEdits(): boolean {
  const s = useStore.getState();
  return s.editing && s.draft !== null && s.draft !== s.openFileText;
}

/**
 * If there are unsaved edits, open the discard-confirmation modal (deferring
 * `then` until the user confirms) and return false to abort the caller. With no
 * unsaved edits, return true so the caller proceeds immediately.
 */
function guardUnsaved(then: DiscardThen): boolean {
  if (!hasUnsavedEdits()) return true;
  const path = useStore.getState().openFilePath;
  useStore.getState().openModal({
    kind: 'confirm-discard',
    filename: path ? basename(path) : 'this file',
    then,
  });
  return false;
}

/**
 * Run a deferred discard action after the user confirms in the modal: drop the
 * draft, close the modal, then perform the pending navigation.
 */
export function confirmDiscardAndContinue(then: DiscardThen): void {
  const s = useStore.getState();
  s.stopEditing();
  s.closeModal();
  switch (then.type) {
    case 'open-file':
      void doOpenFile(then.path, then.history);
      break;
    case 'open-diff':
      void doOpenDiff(then.path);
      break;
    case 'close-panel':
      s.clearNoteHistory();
      s.closeCodePanel();
      break;
    case 'stop-editing':
      break; // stopEditing already happened above
  }
}

/**
 * Apply an open's effect on the note-navigation breadcrumbs. Runs after the
 * unsaved-edits guard passes, so a cancelled navigation never touches the
 * trail. `push` records the file being left; everything else ends (or, for a
 * back-jump, truncates) the trail — see NoteHistoryBehavior.
 */
function applyNoteHistory(behavior: NoteHistoryBehavior, openingPath: string): void {
  const s = useStore.getState();
  if (behavior === 'push') {
    const prev = s.openFilePath;
    if (prev && prev !== openingPath) s.pushNoteHistory(prev);
  } else if (behavior === 'clear') {
    s.clearNoteHistory();
  } else {
    s.truncateNoteHistory(behavior.truncateTo);
  }
}

/**
 * Load a file into the panel (no unsaved-edits guard). Markdown lands on the
 * rendered Preview by default; everything else opens as raw source. Both modes
 * read the same file text.
 */
async function doOpenFile(path: string, history: NoteHistoryBehavior = 'clear'): Promise<void> {
  applyNoteHistory(history, path);
  const mode = isMarkdownPath(path) ? 'preview' : 'file';
  useStore.getState().openInPanel(path, mode);
  await loadFileContent(path);
}

/** Load a file into the panel as a diff (no unsaved-edits guard). */
async function doOpenDiff(path: string): Promise<void> {
  useStore.getState().clearNoteHistory();
  useStore.getState().openInPanel(path, 'diff');
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
  useStore.getState().setFileLoading(true);
  try {
    const result = await window.treeline.files.read(path);
    useStore.getState().applyFileResult(result);
  } catch (err) {
    useStore.getState().setFileError(path, errMsg(err));
  }
}

/** Fetch the diff representation for `path` into the panel. */
async function loadFileDiff(path: string): Promise<void> {
  useStore.getState().setDiffLoading(true);
  try {
    const diff = await window.treeline.files.diff(path);
    useStore.getState().applyDiffResult(diff);
  } catch (err) {
    useStore.getState().setDiffError(path, errMsg(err));
  }
}

/**
 * Open a file in the panel showing its full contents. Used by the tree,
 * quick-open, and (with a non-default `history`) the notes reader's link and
 * back/breadcrumb navigation.
 */
export async function openFileInPanel(
  path: string,
  opts?: { history?: NoteHistoryBehavior },
): Promise<void> {
  const history = opts?.history ?? 'clear';
  if (!guardUnsaved({ type: 'open-file', path, history })) return;
  await doOpenFile(path, history);
}

/**
 * Open `path` and scroll to + highlight `line` (1-based) — the action behind a
 * find-in-files result click. Forces raw 'file' mode (not markdown Preview) so
 * the matched line is actually navigable, then sets the reveal target the
 * CodeMirror view consumes once the text loads.
 */
export async function openFileAtLine(path: string, line: number): Promise<void> {
  if (!guardUnsaved({ type: 'open-file', path })) return;
  useStore.getState().clearNoteHistory();
  useStore.getState().openInPanel(path, 'file');
  await loadFileContent(path);
  useStore.getState().setRevealLine(line);
}

/** Open a file in the panel showing its diff (used by the Changed list). */
export async function openDiffInPanel(path: string): Promise<void> {
  if (!guardUnsaved({ type: 'open-diff', path })) return;
  await doOpenDiff(path);
}

/** Close the panel, warning first if there are unsaved edits. */
export function tryCloseCodePanel(): void {
  if (!guardUnsaved({ type: 'close-panel' })) return;
  const s = useStore.getState();
  s.stopEditing();
  s.clearNoteHistory();
  s.closeCodePanel();
}

/** Leave edit mode (back to read-only), warning first if there are unsaved edits. */
export function tryStopEditing(): void {
  if (!guardUnsaved({ type: 'stop-editing' })) return;
  useStore.getState().stopEditing();
}

/** Save the open file's draft to disk (⌘S / Save button). */
export async function saveOpenFile(): Promise<void> {
  const s = useStore.getState();
  const path = s.openFilePath;
  if (!path || !s.editing || s.draft === null) return;
  if (s.draft === s.openFileText) return; // nothing changed
  const content = s.draft;

  s.setSaving(true);
  try {
    await window.treeline.files.write(path, content);
    useStore.getState().applySaved(path, content);
    // The on-disk file changed — refresh the cached diff (if loaded) and the
    // containing worktree's Changed list so both reflect the save.
    if (useStore.getState().openDiff !== null) void loadFileDiff(path);
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
export function setPanelMode(mode: PanelMode): void {
  const s = useStore.getState();
  const path = s.openFilePath;
  if (!path) return;
  s.setPanelMode(mode);
  // File and Preview both render the file's text; load it on first need.
  const needsFileText = mode === 'file' || mode === 'preview';
  if (needsFileText && s.openFileText === null && s.openFileError === null && !s.openFileLoading) {
    void loadFileContent(path);
  }
  if (mode === 'diff' && s.openDiff === null && s.diffError === null && !s.diffLoading) {
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
