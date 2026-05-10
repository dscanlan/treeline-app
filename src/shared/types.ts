// Shared types — imported by main, preload, and renderer.

export interface Repo {
  /** Absolute, canonicalized repo root path. */
  path: string;
  /** basename(path). */
  name: string;
  /** epoch ms when the user added this repo. */
  addedAt: number;
}

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
}

export type TabStatus = 'running' | 'idle' | 'exited';

export interface Tab {
  id: string;
  ptyId: string;
  /** Worktree path the tab is bound to (the cwd it was spawned in). */
  cwd: string;
  title: string;
  status: TabStatus;
  /** Basename of the foreground child if status === 'running'. */
  foregroundCmd: string | null;
  createdAt: number;
  lastActiveAt: number;
}

export interface AppConfig {
  repos: Repo[];
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
  schemaVersion: 2;
}

export interface TerminalStatusUpdate {
  ptyId: string;
  status: TabStatus;
  foregroundCmd: string | null;
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
