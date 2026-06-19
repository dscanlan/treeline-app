// All IPC channel names live here so main + preload share one source of truth.

export const Channels = {
  // repos
  ReposList: 'repos:list',
  ReposAdd: 'repos:add',
  ReposAddPath: 'repos:addPath',
  ReposCreate: 'repos:create',
  ReposRemove: 'repos:remove',
  ReposPickDirectory: 'repos:pickDirectory',
  ReposDismissDiscovered: 'repos:dismissDiscovered',
  ReposDiscovered: 'repos:discovered',

  // folders (plain non-git directories pinned to the sidebar)
  FoldersRemove: 'folders:remove',

  // worktrees
  WorktreesList: 'worktrees:list',
  WorktreesCreate: 'worktrees:create',
  WorktreesRemove: 'worktrees:remove',
  WorktreesOnChange: 'worktrees:onChange',
  WorktreesDrift: 'worktrees:drift',
  WorktreesCreated: 'worktrees:created',

  // pty
  PtySpawn: 'pty:spawn',
  // List every live PTY so the renderer can re-attach after a reload (its tab
  // state is in-memory and wiped on reload; main's PTYs keep running).
  PtyList: 'pty:list',
  PtyWrite: 'pty:write',
  PtyResize: 'pty:resize',
  PtyKill: 'pty:kill',
  // Freeze / thaw a pane's whole process subtree (SIGSTOP/SIGCONT) — used to
  // park the origin session during a resume-in-worktree handoff.
  PtyPause: 'pty:pause',
  PtyResume: 'pty:resume',
  PtyData: 'pty:data',
  PtyExit: 'pty:exit',
  // Agent-attention notification raised by a terminal (OSC 9/99/777) — see
  // src/main/pty-manager.ts. Carries { id, text }; renderer marks the tab unread.
  PtyNotification: 'pty:notification',

  // processes
  ProcessesSnapshot: 'processes:snapshot',
  ProcessesUpdate: 'processes:update',

  // pull-request status (gh CLI, see src/main/pr-monitor.ts)
  PrSnapshot: 'pr:snapshot',
  PrUpdate: 'pr:update',

  // terminal status
  TerminalStatusUpdate: 'terminalStatus:update',

  // files (code viewer)
  FilesReadDir: 'files:readDir',
  FilesRead: 'files:read',
  FilesChanged: 'files:changed',
  FilesDiff: 'files:diff',
  FilesWrite: 'files:write',

  // config
  ConfigGet: 'config:get',
  ConfigSetCodeRoot: 'config:setCodeRoot',
  ConfigSetSidebarCollapsed: 'config:setSidebarCollapsed',
  ConfigSetSettings: 'config:setSettings',

  // claude session resume (copy a conversation transcript into a worktree's
  // project folder so `claude --resume` can continue it there)
  ClaudeSessionPrepareResume: 'claudeSession:prepareResume',

  // system (open external URLs via the safe-url allowlist)
  SystemOpenExternal: 'system:openExternal',

  // window-level events from main
  SidebarToggle: 'sidebar:toggle',
  BrowserToggle: 'browser:toggle',
  SettingsOpen: 'settings:open',
  // Jump to the most-recently-notified (unread) terminal — menu accelerator
  // (default ⌘⇧U), handled in the renderer.
  JumpToUnread: 'window:jumpToUnread',

  // main → renderer command forwarded from the scriptable CLI socket
  // (see src/main/cli-server.ts). Today only carries `open`.
  CliCommand: 'cli:command',

  // dev-only: hydration channel used by scripts/take-screenshots-auto.sh.
  // Main never sends to this channel in production builds — it's gated on
  // the TREELINE_SCREENSHOT_ID env var. The double-underscore prefix flags
  // the channel as internal/debug.
  ScreenshotHydrate: '__screenshot:hydrate',
  /**
   * Renderer → main heartbeat: "I've finished loadInitialState()." Lets the
   * screenshot harness apply hydrate AFTER the real-config load resolves,
   * otherwise the stock setRepos(cfg.repos) call lands after the hydrate
   * and erases the mocked state.
   */
  ScreenshotReady: '__screenshot:ready',
} as const;

export type ChannelName = (typeof Channels)[keyof typeof Channels];
