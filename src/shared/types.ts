// Shared types — imported by main, preload, and renderer.

import type { PaneNode } from './pane-tree';

export interface Repo {
  /** Absolute, canonicalized repo root path. */
  path: string;
  /** basename(path). */
  name: string;
  /** epoch ms when the user added this repo. */
  addedAt: number;
}

/**
 * A plain (non-git) directory the user has pinned to the sidebar. Same shape as
 * {@link Repo} but semantically distinct: a folder roots a bare file tree with no
 * worktrees and no git Changed/diff features. Added in schemaVersion 4.
 */
export interface Folder {
  /** Absolute directory path. */
  path: string;
  /** basename(path). */
  name: string;
  /** epoch ms when the user added this folder. */
  addedAt: number;
}

/**
 * Result of `repos.addPath`: the main process classifies the picked directory as
 * either a git repo (added with worktrees, today's behavior) or a plain folder.
 */
export type AddPathResult =
  | { kind: 'repo'; repo: Repo }
  | { kind: 'folder'; folder: Folder };

export interface Worktree {
  /** Absolute, canonicalized worktree path. */
  path: string;
  /** Branch name, "(detached)", or "(bare)". */
  branch: string;
  /** 7-char short SHA. */
  commit: string;
  isBare: boolean;
  isDirty: boolean;
  /**
   * Treeline parity field. The Rust app uses this to mark the worktree the user
   * launched from; in Electron we have no shell-cwd to compare against, so this
   * is mostly false. Kept on the type so the visual treatment can stay aligned.
   */
  isCurrent: boolean;
  isClaude: boolean;
}

export type ProcessKind = 'claude' | 'opencode' | 'aider';

export interface DetectedProcess {
  pid: number;
  kind: ProcessKind;
  /** Absolute cwd reported by lsof. */
  cwd: string;
  /** True if cputime hasn't changed for ≥10s. */
  idle: boolean;
}

export interface ProcessSnapshot {
  procs: DetectedProcess[];
  /** Pre-computed longest-prefix mapping cwd → which worktree it belongs to. */
  byWorktreePath: Record<string, DetectedProcess[]>;
  /**
   * Listening TCP ports owned by processes rooted in each worktree, keyed by
   * worktree path. Each port list is deduped and sorted ascending. Computed in
   * the main process from a separate `lsof -iTCP -sTCP:LISTEN` pass, attributed
   * to worktrees by the same longest-prefix match as `byWorktreePath`.
   */
  portsByWorktreePath: Record<string, number[]>;
}

/**
 * GitHub pull-request state for a worktree's branch, surfaced in the sidebar.
 * `draft` is split out from `open` (gh reports it via a separate `isDraft`
 * flag) so the badge can dim it; `merged`/`closed` are terminal states.
 */
export type PrState = 'open' | 'draft' | 'merged' | 'closed';

/** Rolled-up CI status across a PR's checks (gh's `statusCheckRollup`). */
export type PrChecks = 'passing' | 'failing' | 'pending';

/**
 * Pull-request metadata for a single branch, sourced from the `gh` CLI (see
 * `src/main/gh.ts`). Lives in a side map keyed by repo+branch
 * (`prByRepoBranch` in the renderer store) rather than on {@link Worktree}, so
 * `git-porcelain.ts` and the worktree list stay pure and network-free.
 */
export interface PrInfo {
  /** PR number, e.g. 482. */
  number: number;
  state: PrState;
  /** Web URL, opened on badge click via `system.openExternal`. */
  url: string;
  /** CI rollup; null when the PR has no checks. */
  checks: PrChecks | null;
}

/**
 * One PR-monitor broadcast (see `src/main/pr-monitor.ts`): the full
 * branch→PR map for a single repo. Sent on the `pr:update` channel whenever a
 * repo's PR set changes, and held as the latest-per-repo snapshot served by
 * `pr:snapshot`.
 */
export interface PrSnapshot {
  repoPath: string;
  /** Keyed by branch name (`headRefName`). */
  prByBranch: Record<string, PrInfo>;
}

export type TabStatus = 'running' | 'idle' | 'exited';

/**
 * A tab hosts a *tree* of terminal panes (see `shared/pane-tree.ts`), not a
 * single PTY. `root` is the pane tree; `focusedPaneId` points at the leaf that
 * has keyboard focus. Per-PTY status / process metadata lives on each
 * {@link PaneLeaf}; the tab-level `cwd` is the worktree the tab is bound to and
 * still drives the `tabsByCwd` MRU index.
 */
export interface Tab {
  id: string;
  /** Worktree path the tab is bound to (the cwd it was spawned in). */
  cwd: string;
  title: string;
  root: PaneNode;
  /** Pane id of the focused leaf within `root`. */
  focusedPaneId: string;
  createdAt: number;
  lastActiveAt: number;
}

/**
 * User-customizable settings (terminal theming + keybindings). Persisted inside
 * `AppConfig.settings`. Added in schemaVersion 3; older configs are
 * default-filled by `ReposStore.migrate()`.
 *
 * - `terminalTheme` is a preset id from `shared/terminal-theme.ts`
 *   (`TerminalThemeId`); stored loosely as a string so an unknown/legacy id
 *   degrades to the default rather than failing to parse.
 * - `keybindings` is a sparse override map keyed by `KeybindingCommand`
 *   (`shared/keybindings.ts`); only commands the user has rebound appear here.
 *   The effective map is computed via `resolveKeybindings(settings.keybindings)`.
 */
export interface SettingsConfig {
  /** xterm theme preset id (see TerminalThemeId). */
  terminalTheme: string;
  /** Monospace font stack handed to xterm. */
  fontFamily: string;
  /** Terminal font size in px. */
  fontSize: number;
  /** Sparse command id → accelerator overrides over the factory defaults. */
  keybindings: Record<string, string>;
}

export interface AppConfig {
  repos: Repo[];
  /**
   * Plain (non-git) directories pinned to the sidebar as bare file trees. Added
   * in schemaVersion 4; older configs default-fill this to []. See {@link Folder}.
   */
  folders: Folder[];
  /** Optional: parent dir for future "discover under root" features. */
  codeRoot: string | null;
  /** Persisted sidebar collapse state. */
  sidebarCollapsed: boolean;
  /**
   * Repo toplevels the user has chosen not to be re-prompted about when their
   * cwd lands inside one. Populated by the "Don't ask again" action on the
   * discovered-repo toast.
   */
  dismissedRepos: string[];
  /**
   * User settings (terminal theme/font + keybinding overrides). Added in
   * schemaVersion 3. Always present after migrate() default-fills it.
   */
  settings: SettingsConfig;
  schemaVersion: 4;
}

export interface TerminalStatusUpdate {
  ptyId: string;
  status: TabStatus;
  foregroundCmd: string | null;
}

/**
 * One entry in a directory listing, returned by `files.readDir`. `path` is the
 * absolute path of the entry; `type` distinguishes files from subdirectories so
 * the file tree can show disclosure chevrons and lazy-load on expand.
 */
export interface DirEntry {
  name: string;
  path: string;
  type: 'file' | 'dir';
}

/**
 * Result of `files.read`. `text` is the file's UTF-8 contents (empty when
 * `binary` is true). `truncated` flags that the file exceeded the read cap and
 * only a prefix is returned; `binary` flags that a NUL byte was detected and the
 * viewer should show a placeholder rather than garbage.
 */
export interface FileContents {
  path: string;
  text: string;
  truncated: boolean;
  binary: boolean;
}

/**
 * One row of a unified diff. `hunk` rows carry the `@@` section heading; the
 * line-number fields are null where they don't apply (e.g. `newLine` on a
 * deletion). `text` is the line content without the leading +/-/space.
 */
export interface DiffLine {
  kind: 'context' | 'add' | 'del' | 'hunk';
  oldLine: number | null;
  newLine: number | null;
  text: string;
}

/** A file's unified diff (working tree vs HEAD), parsed for the viewer. */
export interface FileDiff {
  path: string;
  lines: DiffLine[];
  /** Total added / removed line counts, for the summary header. */
  added: number;
  removed: number;
  /** Git reported a binary change; `lines` is empty. */
  binary: boolean;
}

/** Category derived from a `git status --porcelain` XY code, for the changed-files list. */
export type ChangedFileStatus =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'untracked'
  | 'conflicted';

/**
 * One entry in a worktree's working-tree change set (`git status`). `path` is
 * absolute (ready to open in the viewer); `relPath` is relative to the worktree
 * root, for display.
 */
export interface ChangedFile {
  path: string;
  relPath: string;
  status: ChangedFileStatus;
  /**
   * True when this entry is a directory rather than a regular file. Git
   * collapses a brand-new untracked folder into a single `?? dir/` entry, so a
   * change row can point at a directory. Such rows have no diff and must not be
   * opened in the viewer.
   */
  isDir?: boolean;
}

/**
 * A scratch terminal: a shell session not bound to any tracked repo. Lives in
 * renderer state only (never persisted to AppConfig), but the shape is shared
 * so the screenshot harness can hydrate scratch rows for capture scenarios.
 */
export interface Scratch {
  /** Mirrors the PTY id; reused as the Tab id too. */
  id: string;
  /** Display label in the sidebar, e.g. "Scratch 1". */
  label: string;
  /** PTY session id; identical to `id` today, kept separate for clarity. */
  ptyId: string;
  /** Working directory at spawn time — homedir for user-spawned scratches. */
  cwd: string;
  createdAt: number;
}
