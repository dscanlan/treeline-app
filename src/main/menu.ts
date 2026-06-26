import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  shell,
  type MenuItemConstructorOptions,
} from 'electron';
import { Channels } from '@shared/ipc-channels';
import { resolveKeybindings, type ResolvedKeybindings } from '@shared/keybindings';
import { checkForUpdatesManual } from './updater';
import { cliShimPath, GLOBAL_CLI_PATH, installGlobalCli } from './cli-install';

/**
 * Symlink the `treeline` shim into a global PATH dir so it's usable from
 * terminals outside the app, then report the outcome. (Agents *inside* the app
 * already get it auto-injected — see `cli-install.ts`.)
 */
async function installCli(): Promise<void> {
  const res = installGlobalCli();
  const win = BrowserWindow.getFocusedWindow();
  const opts = res.ok
    ? {
        type: 'info' as const,
        message: 'Installed the treeline CLI',
        detail: `\`treeline\` is now available at ${res.path}. Open a new terminal, then run \`treeline ping\`.`,
      }
    : {
        type: 'error' as const,
        message: 'Could not install the treeline CLI',
        detail: `${res.error}\n\nInstall it manually (copy/paste):\n  sudo ln -sf "${cliShimPath()}" ${GLOBAL_CLI_PATH}`,
      };
  if (win) await dialog.showMessageBox(win, opts);
  else await dialog.showMessageBox(opts);
}

/** Docs on GitHub, opened from the Help menu so packaged-app users can find them. */
const DOCS = {
  userGuide: 'https://github.com/dscanlan/treeline-app/blob/main/docs/USER_GUIDE.md',
  cli: 'https://github.com/dscanlan/treeline-app/blob/main/docs/CLI.md',
  repo: 'https://github.com/dscanlan/treeline-app',
} as const;

/**
 * Build the macOS app menu. Accelerators are driven by the resolved keybinding
 * map (see `shared/keybindings.ts`) rather than hard-coded, so user rebindings
 * in Settings take effect after `buildAppMenu()` is re-run with the new map.
 * Defaults are used when no map is supplied (e.g. very first build before config
 * has loaded).
 */
export function buildAppMenu(keybindings?: ResolvedKeybindings): void {
  const isMac = process.platform === 'darwin';
  const appName = app.name;
  const kb = keybindings ?? resolveKeybindings(undefined);

  const send = (channel: string) => () => {
    const win = BrowserWindow.getFocusedWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel);
    }
  };
  const sendSidebarToggle = send(Channels.SidebarToggle);
  const sendOpenSettings = send(Channels.SettingsOpen);
  const sendJumpToUnread = send(Channels.JumpToUnread);

  const sendBrowserToggle = () => {
    const win = BrowserWindow.getFocusedWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(Channels.BrowserToggle);
    }
  };
  const sendScratchpadToggle = send(Channels.ScratchpadToggle);
  const sendQuickOpenFile = send(Channels.QuickOpenFile);
  const sendFindInFiles = send(Channels.FindInFiles);

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: appName,
            submenu: [
              { role: 'about' as const },
              {
                label: 'Check for Updates…',
                click: () => void checkForUpdatesManual(),
              },
              {
                label: 'Install Command Line Tool…',
                click: () => void installCli(),
              },
              { type: 'separator' as const },
              {
                label: 'Settings…',
                accelerator: kb.openSettings,
                click: sendOpenSettings,
              },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ],
          },
        ]
      : []),
    {
      label: 'File',
      submenu: [isMac ? { role: 'close' as const } : { role: 'quit' as const }],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' as const },
        { role: 'redo' as const },
        { type: 'separator' as const },
        { role: 'cut' as const },
        { role: 'copy' as const },
        { role: 'paste' as const },
        { role: 'selectAll' as const },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Toggle Sidebar',
          accelerator: kb.toggleSidebar,
          click: sendSidebarToggle,
        },
        {
          label: 'Toggle Browser',
          accelerator: kb.toggleBrowser,
          click: sendBrowserToggle,
        },
        {
          label: 'Toggle Scratchpad',
          accelerator: kb.toggleScratchpad,
          click: sendScratchpadToggle,
        },
        {
          label: 'Jump to Unread Agent',
          accelerator: kb.jumpToUnread,
          click: sendJumpToUnread,
        },
        { type: 'separator' as const },
        {
          label: 'Quick Open File…',
          accelerator: kb.quickOpenFile,
          click: sendQuickOpenFile,
        },
        {
          label: 'Find in Files…',
          accelerator: kb.findInFiles,
          click: sendFindInFiles,
        },
        { type: 'separator' as const },
        { role: 'reload' as const },
        { role: 'forceReload' as const },
        { role: 'toggleDevTools' as const },
        { type: 'separator' as const },
        { role: 'resetZoom' as const },
        { role: 'zoomIn' as const },
        { role: 'zoomOut' as const },
        { type: 'separator' as const },
        { role: 'togglefullscreen' as const },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' as const },
        { role: 'zoom' as const },
        ...(isMac
          ? [
              { type: 'separator' as const },
              { role: 'front' as const },
              { type: 'separator' as const },
              { role: 'window' as const },
            ]
          : [{ role: 'close' as const }]),
      ],
    },
    {
      role: 'help',
      submenu: [
        {
          label: 'User Guide',
          click: () => void shell.openExternal(DOCS.userGuide),
        },
        {
          label: 'CLI Reference',
          click: () => void shell.openExternal(DOCS.cli),
        },
        { type: 'separator' as const },
        {
          label: `${appName} on GitHub`,
          click: () => void shell.openExternal(DOCS.repo),
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
