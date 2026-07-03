import type { CliRendererCommand } from './cli-protocol';
import type {
  AddPathResult,
  AppConfig,
  ChangedFile,
  ContentSearchOptions,
  ContentSearchResult,
  DetectedProcess,
  DirEntry,
  FileContents,
  FileDiff,
  Folder,
  PersistedSession,
  PrInfo,
  PrSnapshot,
  ProcessSnapshot,
  Repo,
  Scratch,
  SettingsConfig,
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
  /** Plain non-git folder roots pinned to the sidebar (the "Open Folder" feature). */
  folders?: Folder[];
  worktreesByRepo?: Record<string, Worktree[]>;
  selected?: string | null;
  pendingDiscoveries?: { repoPath: string; viaCwd: string }[];
  /** Seed the "open a terminal in this worktree?" toast (drift slice). */
  driftByWorktree?: Record<
    string,
    { toWorktree: string; reason: 'drift' | 'created'; ptyId?: string }
  >;
  /**
   * Seed the parked-session overlay (handoff slice): a pane whose Claude
   * conversation was resumed in a worktree, so it's frozen with a "Session
   * paused" overlay. Keyed by the parked origin pane's pty id.
   */
  handoffByOriginPty?: Record<
    string,
    {
      originPtyId: string;
      originTabId: string;
      originCwd: string;
      worktreeCwd: string;
      forkTabId: string;
    }
  >;
  filter?: string;
  sidebarCollapsed?: boolean;
  /** Override the persisted settings (theme/font/keybindings) for the capture. */
  settings?: SettingsConfig;
  modal?:
    | { kind: 'create-worktree'; repoPath: string }
    | { kind: 'delete-worktree'; repoPath: string; worktreePath: string; branch: string }
    | { kind: 'create-repo' }
    | { kind: 'settings' }
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
  /**
   * Seed the transient agent-attention unread map (pty id → {text, at}) so the
   * harness can capture the pane ring + tab/sidebar "waiting" badges without an
   * agent actually firing a notification.
   */
  unreadByPtyId?: Record<string, { text: string; at: number }>;
  /** Seed the "↻ Restored N terminals" reload-reattach toast for capture. */
  reattachNotice?: { count: number; at: number } | null;
  /** Seed the cold-start "Restore previous session?" prompt (RestorePrompt). */
  pendingRestore?: PersistedSession | null;
  /** Replace processesByWorktreePath wholesale — drives the magenta `claude`/`opencode`/`aider` badges in WorktreeRow. */
  processesByWorktreePath?: Record<string, DetectedProcess[]>;
  /** Replace portsByWorktreePath wholesale — drives the listening-port chips in WorktreeRow. */
  portsByWorktreePath?: Record<string, number[]>;
  /** Replace prByRepoBranch wholesale — drives the PR-status badge in WorktreeRow. */
  prByRepoBranch?: Record<string, Record<string, PrInfo>>;
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
  panelMode?: 'file' | 'diff' | 'preview';
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
  /**
   * Embedded-browser pane state (BrowserPane). Lets the harness open the
   * `<webview>` beside a terminal and seed the address bar / nav buttons so the
   * Browser scenario can be captured without driving the UI. `browserSrc` is the
   * URL committed into the webview's `src`; the scenario serves a local page at
   * that URL so the capture shows rendered content rather than a load error.
   */
  browserPanelOpen?: boolean;
  browserPanelWidth?: number;
  browserSrc?: string;
  browserAddress?: string;
  browserTitle?: string | null;
  browserCanGoBack?: boolean;
  browserCanGoForward?: boolean;
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
     * Add a picked directory, classified by main: a git repo (added with
     * worktrees, like `add`) or a plain non-git folder pinned as a bare file
     * tree. Backs the "+ Add repo / folder" button. See {@link AddPathResult}.
     */
    addPath(absPath: string): Promise<AddPathResult>;
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
    /**
     * Subscribe to "a terminal's cwd drifted into a different worktree" events
     * (e.g. `git worktree add` + `cd`). The handler is invoked per PTY when its
     * cwd moves into a known worktree other than the one it spawned in.
     * Returns an unsubscribe fn.
     */
    onDrift(cb: (e: { ptyId: string; toWorktree: string }) => void): () => void;
    /**
     * Subscribe to "a new worktree was just created" events (e.g. an agent ran
     * `git worktree add`). The handler is invoked once per newly-appeared
     * worktree path during the session. Returns an unsubscribe fn.
     */
    onCreated(cb: (path: string) => void): () => void;
  };

  pty: {
    spawn(opts: {
      cwd: string;
      shell?: string;
      cols: number;
      rows: number;
      /**
       * Sidebar label ("Scratch N") when spawning a scratch terminal. Main keeps
       * it on the live PTY and echoes it back from {@link list}, so a reload
       * re-attach can rebuild the scratch's sidebar row instead of dropping it.
       */
      scratchLabel?: string;
    }): Promise<{ id: string }>;
    /**
     * Every live PTY in the main process, so the renderer can re-attach after a
     * reload (its tab state is in-memory and wiped on reload, but these shells
     * keep running). The re-mounted terminal nudges a resize to make a TUI
     * repaint its current frame — no captured output is replayed. `scratchLabel`
     * is present only for scratch PTYs (its sidebar label, for re-seeding the row).
     */
    list(): Promise<{ id: string; cwd: string; scratchLabel?: string }[]>;
    write(id: string, data: string): void;
    resize(id: string, cols: number, rows: number): void;
    kill(id: string): Promise<void>;
    /**
     * Freeze this pane's whole process subtree (shell + agent + children) with
     * SIGSTOP. Used to park the origin session when its conversation is resumed
     * in a worktree, so two copies can't run at once. Resolves true if frozen.
     */
    pause(id: string): Promise<boolean>;
    /** Thaw a {@link pause}d pane (SIGCONT). Resolves true if resumed. */
    resume(id: string): Promise<boolean>;
    onData(id: string, cb: (chunk: string) => void): () => void;
    onExit(
      id: string,
      cb: (info: { code: number; signal: number | null }) => void,
    ): () => void;
    /**
     * Agent-attention notifications raised by a terminal via an OSC 9/99/777
     * desktop-notification escape. Unfiltered — the callback receives the
     * raising pty's id so the renderer can mark the right tab unread.
     */
    onNotification(cb: (e: { id: string; text: string }) => void): () => void;
  };

  processes: {
    snapshot(): Promise<ProcessSnapshot>;
    subscribe(cb: (snapshot: ProcessSnapshot) => void): () => void;
  };

  /**
   * GitHub pull-request status per branch, sourced from the `gh` CLI (see
   * src/main/pr-monitor.ts). `snapshot` returns the latest-known map per repo
   * (`{ [repoPath]: { [branch]: PrInfo } }`) for first paint; `subscribe`
   * streams per-repo deltas. Empty/absent when `gh` is unavailable.
   */
  pr: {
    snapshot(): Promise<Record<string, Record<string, PrInfo>>>;
    subscribe(cb: (snapshot: PrSnapshot) => void): () => void;
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

  /**
   * Ripgrep-backed search scoped to a single worktree/folder `root` (the
   * selected sidebar target). Respects `.gitignore`; works in git repos and
   * plain folders alike. See `src/main/search.ts`.
   */
  search: {
    /** Find-in-files (⌘⇧F): match line contents under `root`. */
    content(
      root: string,
      query: string,
      opts?: ContentSearchOptions,
    ): Promise<ContentSearchResult>;
    /** Enumerate files under `root` for the fuzzy quick-open list (⌘P). */
    files(root: string): Promise<string[]>;
  };

  /**
   * Plain (non-git) folders pinned to the sidebar. They're added via
   * `repos.addPath` (which classifies repo vs folder) and listed through
   * `config.get().folders`; this namespace only handles removal.
   */
  folders: {
    /** Unpin a plain folder from the sidebar. */
    remove(absPath: string): Promise<void>;
  };

  /**
   * Continue an existing Claude Code conversation inside a freshly-created
   * worktree. Claude keys transcripts by directory, so the same session can't be
   * resumed from a worktree natively; `prepareResume` finds the active session in
   * the worktree's parent repo and copies its transcript into the worktree's
   * project folder, returning the session id to pass to `claude --resume`.
   * Resolves null when the parent repo has no Claude session to resume.
   */
  claudeSession: {
    prepareResume(
      worktreePath: string,
    ): Promise<{ sessionId: string; originCwd: string } | null>;
    /**
     * The most-recently-modified Claude session id for `cwd`, or null when that
     * directory has no transcript. Unlike {@link prepareResume} this copies
     * nothing — restore uses it to re-run `claude --resume <id>` in a respawned
     * pane that was running Claude when the session was last saved.
     */
    latestForCwd(cwd: string): Promise<string | null>;
    /**
     * pane (pty) id → session id, as reported by each pane's Claude Code
     * SessionStart hook over the CLI socket. The debounced session save pins
     * these per-pane — the exact conversation even when two panes share a cwd,
     * where {@link latestForCwd}'s newest-transcript heuristic can't tell them
     * apart. Panes with no reported session are absent.
     */
    idsByPane(): Promise<Record<string, string>>;
  };

  /**
   * Persisted tab layout (`session.json`). `get` is read once on launch to offer
   * a restore after a full restart; `set` receives a debounced snapshot of the
   * current tabs from the renderer. See {@link PersistedSession}.
   */
  session: {
    get(): Promise<PersistedSession>;
    set(session: PersistedSession): Promise<void>;
  };

  /**
   * The single persistent scratchpad buffer (`scratchpad.json`). `get` is read
   * once on launch; `set` receives the (debounced / on-blur) current text. Main
   * caps and string-coerces the payload — see src/main/scratchpad-store.ts.
   */
  scratchpad: {
    get(): Promise<string>;
    set(text: string): Promise<void>;
  };

  config: {
    get(): Promise<AppConfig>;
    setCodeRoot(p: string | null): Promise<void>;
    setSidebarCollapsed(v: boolean): Promise<void>;
    /** Persist the whole settings object (terminal theme/font + keybindings). */
    setSettings(settings: SettingsConfig): Promise<void>;
  };

  window: {
    /** Subscribe to the ⌘B accelerator from the main process. */
    onSidebarToggle(cb: () => void): () => void;
    /** Subscribe to the ⌘⇧B accelerator that toggles the embedded browser pane. */
    onBrowserToggle(cb: () => void): () => void;
    /** Subscribe to the ⌘⇧N accelerator that toggles the scratchpad panel. */
    onScratchpadToggle(cb: () => void): () => void;
    /** Subscribe to the "Open Settings" menu item / accelerator from main. */
    onOpenSettings(cb: () => void): () => void;
    /** Subscribe to the ⌘⇧U accelerator that jumps to the most-recent unread. */
    onJumpToUnread(cb: () => void): () => void;
    /** Subscribe to the ⌘⇧P accelerator that opens the fuzzy file quick-open. */
    onQuickOpenFile(cb: () => void): () => void;
    /** Subscribe to the ⌘⇧F accelerator that opens find-in-files. */
    onFindInFiles(cb: () => void): () => void;
  };

  /**
   * Commands forwarded from the scriptable CLI socket (see
   * src/main/cli-server.ts). The socket server lives in main and has no store
   * access, so verbs that need the UI — currently just `open` — are relayed
   * here for the renderer to act on. Returns an unsubscribe fn.
   */
  cli: {
    onCommand(cb: (cmd: CliRendererCommand) => void): () => void;
  };

  /**
   * Static system info populated synchronously by the preload script. No IPC
   * round-trip — values are baked at preload load time. Used today by the
   * scratch-terminal action which needs `os.homedir()` to pick the spawn cwd.
   */
  system: {
    homeDir: string;
    /**
     * Open an external URL in the OS default browser (today: clicking a PR
     * badge). Validated in main against the same web/mail allowlist as
     * terminal links (`isSafeExternalUrl`); non-web schemes are dropped.
     */
    openExternal(url: string): Promise<void>;
    /**
     * Whether an absolute path still exists on disk. Used by session-restore to
     * skip tabs whose worktree was removed while the app was closed.
     */
    pathExists(path: string): Promise<boolean>;
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
