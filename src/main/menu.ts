import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron';
import { Channels } from '@shared/ipc-channels';
import { resolveKeybindings, type ResolvedKeybindings } from '@shared/keybindings';
import { checkForUpdatesManual } from './updater';

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

  const sendBrowserToggle = () => {
    const win = BrowserWindow.getFocusedWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(Channels.BrowserToggle);
    }
  };

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
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
