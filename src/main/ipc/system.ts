import { ipcMain, shell } from 'electron';
import { Channels } from '@shared/ipc-channels';
import { isSafeExternalUrl } from '../util/safe-url';

/**
 * Renderer-initiated external link opens (today: clicking a PR badge). Routed
 * through the exact same web/mail allowlist as the window-open handler in
 * `main/index.ts` (`isSafeExternalUrl`) — the renderer is sandboxed and its
 * content is attacker-influenceable, so anything that isn't http/https/mailto
 * is dropped silently.
 */
export function registerSystemIpc(): () => void {
  ipcMain.handle(Channels.SystemOpenExternal, async (_e, url: string) => {
    if (typeof url === 'string' && isSafeExternalUrl(url)) {
      await shell.openExternal(url);
    }
  });
  return () => ipcMain.removeHandler(Channels.SystemOpenExternal);
}
