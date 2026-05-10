// All IPC channel names live here so main + preload share one source of truth.

export const Channels = {
  // repos
  ReposList: 'repos:list',
  ReposAdd: 'repos:add',
  ReposCreate: 'repos:create',
  ReposRemove: 'repos:remove',
  ReposPickDirectory: 'repos:pickDirectory',
  ReposDismissDiscovered: 'repos:dismissDiscovered',
  ReposDiscovered: 'repos:discovered',

  // worktrees
  WorktreesList: 'worktrees:list',
  WorktreesCreate: 'worktrees:create',
  WorktreesRemove: 'worktrees:remove',
  WorktreesOnChange: 'worktrees:onChange',

  // pty
  PtySpawn: 'pty:spawn',
  PtyWrite: 'pty:write',
  PtyResize: 'pty:resize',
  PtyKill: 'pty:kill',
  PtyData: 'pty:data',
  PtyExit: 'pty:exit',

  // processes
  ProcessesSnapshot: 'processes:snapshot',
  ProcessesUpdate: 'processes:update',

  // terminal status
  TerminalStatusUpdate: 'terminalStatus:update',

  // config
  ConfigGet: 'config:get',
  ConfigSetCodeRoot: 'config:setCodeRoot',
  ConfigSetSidebarCollapsed: 'config:setSidebarCollapsed',

  // window-level events from main
  SidebarToggle: 'sidebar:toggle',

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
