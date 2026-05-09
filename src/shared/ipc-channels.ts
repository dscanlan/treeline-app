// All IPC channel names live here so main + preload share one source of truth.

export const Channels = {
  // repos
  ReposList: 'repos:list',
  ReposAdd: 'repos:add',
  ReposRemove: 'repos:remove',
  ReposPickDirectory: 'repos:pickDirectory',

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
} as const;

export type ChannelName = (typeof Channels)[keyof typeof Channels];
