import { existsSync } from 'node:fs';
import { ipcMain, shell } from 'electron';
import { Channels } from '@shared/ipc-channels';
import { isSafeExternalUrl } from '../util/safe-url';
import { validateAbsPath } from '../util/safe-path';

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

  // Existence check for session-restore — skip tabs whose worktree was removed
  // while the app was closed. Returns false for a malformed/relative path rather
  // than throwing, since "doesn't exist" is the right answer for the caller.
  ipcMain.handle(Channels.SystemPathExists, async (_e, rawPath: unknown) => {
    try {
      return existsSync(validateAbsPath(rawPath));
    } catch {
      return false;
    }
  });

  return () => {
    ipcMain.removeHandler(Channels.SystemOpenExternal);
    ipcMain.removeHandler(Channels.SystemPathExists);
  };
}
