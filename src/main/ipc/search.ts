import { ipcMain } from 'electron';
import type { ContentSearchOptions } from '@shared/types';
import { Channels } from '@shared/ipc-channels';
import { resolveRgPath } from '../rg-path';
import { listFiles, searchContent } from '../search';
import { validateAbsPath } from '../util/safe-path';

/**
 * Ripgrep-backed search IPC. Validates the renderer-supplied `root` (the
 * selected worktree/folder) and forwards to the pure `../search.ts`; the rg
 * binary path is resolved here (the electron-dependent half).
 */
function coerceOptions(raw: unknown): ContentSearchOptions {
  if (typeof raw !== 'object' || raw === null) return {};
  const o = raw as Record<string, unknown>;
  return {
    caseSensitive: o.caseSensitive === true,
    regex: o.regex === true,
    wholeWord: o.wholeWord === true,
  };
}

export function registerSearchIpc(): () => void {
  ipcMain.handle(
    Channels.SearchContent,
    async (_e, rawRoot: unknown, rawQuery: unknown, rawOpts: unknown) => {
      const root = validateAbsPath(rawRoot);
      if (typeof rawQuery !== 'string') throw new Error('query must be a string');
      return searchContent(resolveRgPath(), root, rawQuery, coerceOptions(rawOpts));
    },
  );

  ipcMain.handle(Channels.SearchFiles, async (_e, rawRoot: unknown) => {
    return listFiles(resolveRgPath(), validateAbsPath(rawRoot));
  });

  return () => {
    ipcMain.removeHandler(Channels.SearchContent);
    ipcMain.removeHandler(Channels.SearchFiles);
  };
}
