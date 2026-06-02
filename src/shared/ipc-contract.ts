import type {
  AppConfig,
  ChangedFile,
  DetectedProcess,
  DirEntry,
  FileContents,
  FileDiff,
  ProcessSnapshot,
  Repo,
  Scratch,
  Tab,
  TabStatus,
  TerminalStatusUpdate,
  Worktree,
} from './types';

/**
 * Renderer-state injection payload for the dev-only screenshot harness.
 * Main builds these for each scenario in src/main/screenshot.ts and the
 * renderer applies them straight into the Zustand store before capture.
 */
export interface ScreenshotHydratePayload {
  /** Wipe slices + localStorage before applying. Always set in practice. */
  reset?: boolean;
  repos?: Repo[];
  worktreesByRepo?: Record<string, Worktree[]>;
  selected?: string | null;
  pendingDiscoveries?: { repoPath: string; viaCwd: string }[];
  filter?: string;
  sidebarCollapsed?: boolean;
  modal?:
    | { kind: 'create-worktree'; repoPath: string }
    | { kind: 'delete-worktree'; repoPath: string; worktreePath: string; branch: string }
    | { kind: 'create-repo' }
    | {
        kind: 'confirm-discard';
        filename: string;
        then:
          | { type: 'open-file'; path: string }
          | { type: 'open-diff'; path: string }
          | { type: 'close-panel' }
          | { type: 'stop-editing' };
      }
    | null;
  /** Inject scratch-terminal rows into the sidebar. */
  scratches?: Scratch[];
  /** Highlight a scratch row as selected. Mutually exclusive with `selected`. */
  selectedScratchId?: string | null;
  /**
   * Tabs to inject into the TabsSlice. The harness supplies real `ptyId`s
   * (returned by PtyManager.spawn) so xterm subscribes to live PTY data.
   */
  tabs?: Tab[];
  activeTabId?: string | null;
  /** Replace processesByWorktreePath wholesale — drives the magenta `claude`/`opencode`/`aider` badges in WorktreeRow. */
  processesByWorktreePath?: Record<string, DetectedProcess[]>;
  /** Synthesised TerminalStatusUpdate batch — drives the green/cyan/dim status dots. */
  terminalStatus?: TerminalStatusUpdate[];
  /**
   * Code-viewer state for the editor slice — drives the file tree, the
   * All|Changed list, and the split code panel (file or diff) so the harness
   * can capture the code viewer without driving the UI.
   */
  expandedDirs?: Record<string, boolean>;
  dirChildren?: Record<string, DirEntry[]>;
  worktreeFileView?: Record<string, 'all' | 'changed'>;
  changedByWorktree?: Record<string, ChangedFile[]>;
  codePanelOpen?: boolean;
  codePanelWidth?: number;
  openFilePath?: string | null;
  panelMode?: 'file' | 'diff';
  openFileText?: string | null;
  openDiff?: FileDiff | null;
  editing?: boolean;
  draft?: string | null;
  saveError?: string | null;
  /**
   * Render an in-renderer tooltip near the matched element. Used by the
   * 18-add-button-tooltip scenario because the OS-rendered HTML title
   * tooltip is outside the renderer bitmap and `webContents.capturePage()`
   * literally cannot see it.
   */
  forceTooltipNear?: { selector: string; text: string };
}

/**
 * Options for `repos.create`. `new-folder` creates a fresh directory under
 * `basePath` named `folderName`; `existing-folder` initializes a repo in
 * `basePath` itself, which must already exist and be empty.
 */
export interface CreateRepoApiOpts {
  mode: 'new-folder' | 'existing-folder';
  basePath: string;
  folderName?: string;
  branch: string;
}

// The shape exposed to the renderer via contextBridge as `window.treeline`.
export interface TreelineApi {
  repos: {
    list(): Promise<Repo[]>;
    add(absPath: string): Promise<Repo>;
    /**
     * Initialize a new git repo and register it in the store. Validates
     * strictly: target must not already be a repo, new-folder names must not
     * collide, existing-folder targets must be empty (`.DS_Store` ignored).
     */
    create(opts: CreateRepoApiOpts): Promise<Repo>;
    remove(absPath: string): Promise<void>;
    pickDirectory(): Promise<string | null>;
    /**
     * Mark a discovered (untracked) repo as one the user does not want to be
     * re-prompted about. Persisted in `AppConfig.dismissedRepos`.
     */
    dismissDiscovered(absPath: string): Promise<void>;
    /**
     * Subscribe to repos noticed via PTY cwds. The handler is invoked once
     * per untracked, non-dismissed repo whose path appears in any tab's cwd.
     * Returns an unsubscribe fn.
     */
    onDiscovered(cb: (e: { repoPath: string; viaCwd: string }) => void): () => void;
  };

  worktrees: {
    list(repoPath: string): Promise<Worktree[]>;
    create(repoPath: string, branch: string, path: string): Promise<void>;
    remove(path: string): Promise<void>;
    /** Subscribe to worktree-changed events. Returns an unsubscribe fn. */
    onChange(cb: (repoPath: string) => void): () => void;
  };

  pty: {
    spawn(opts: {
      cwd: string;
      shell?: string;
      cols: number;
      rows: number;
    }): Promise<{ id: string }>;
    write(id: string, data: string): void;
    resize(id: string, cols: number, rows: number): void;
    kill(id: string): Promise<void>;
    onData(id: string, cb: (chunk: string) => void): () => void;
    onExit(
      id: string,
      cb: (info: { code: number; signal: number | null }) => void,
    ): () => void;
  };

  processes: {
    snapshot(): Promise<ProcessSnapshot>;
    subscribe(cb: (snapshot: ProcessSnapshot) => void): () => void;
  };

  terminalStatus: {
    subscribe(cb: (updates: TerminalStatusUpdate[]) => void): () => void;
  };

  /**
   * Filesystem access for the code viewer. `readDir` lazily lists one
   * directory's children (tree expands on demand); `read` returns a file's
   * contents with size/binary guards (see FileContents); `write` saves edits.
   */
  files: {
    readDir(path: string): Promise<DirEntry[]>;
    read(path: string): Promise<FileContents>;
    /** Working-tree changes (git status) for the worktree at `path`. */
    changed(path: string): Promise<ChangedFile[]>;
    /** Unified diff (working tree vs HEAD) for the file at `path`. */
    diff(path: string): Promise<FileDiff>;
    /** Atomically overwrite the existing file at `path` with `content`. */
    write(path: string, content: string): Promise<void>;
  };

  config: {
    get(): Promise<AppConfig>;
    setCodeRoot(p: string | null): Promise<void>;
    setSidebarCollapsed(v: boolean): Promise<void>;
  };

  window: {
    /** Subscribe to the ⌘B accelerator from the main process. */
    onSidebarToggle(cb: () => void): () => void;
  };

  /**
   * Static system info populated synchronously by the preload script. No IPC
   * round-trip — values are baked at preload load time. Used today by the
   * scratch-terminal action which needs `os.homedir()` to pick the spawn cwd.
   */
  system: {
    homeDir: string;
  };

  /**
   * Dev-only channel used by the screenshot harness. Always exposed (so the
   * preload contract stays a single shape across builds) but only fires when
   * main sends a hydrate payload, which it does only under the
   * TREELINE_SCREENSHOT_ID env var. Treat as a no-op surface in production.
   */
  screenshot: {
    onHydrate(cb: (payload: ScreenshotHydratePayload) => void): () => void;
    /** Signal that the renderer has fully hydrated its initial state. */
    signalReady(): void;
  };
}

declare global {
  interface Window {
    treeline: TreelineApi;
  }
}

// Re-export status type for callers that import "the IPC types" only.
export type { TabStatus };
