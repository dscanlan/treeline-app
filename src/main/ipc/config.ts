import { ipcMain } from 'electron';
import { Channels } from '@shared/ipc-channels';
import type { SettingsConfig } from '@shared/types';
import {
  MAX_TERMINAL_FONT_SIZE,
  MIN_TERMINAL_FONT_SIZE,
} from '@shared/terminal-theme';
import type { ReposStore } from '../repos-store';

/**
 * Coerce an untrusted renderer payload into a valid SettingsConfig. Throws on a
 * non-object; otherwise sanitizes every field (clamps fontSize, drops non-string
 * keybinding values) so a malformed payload can never corrupt the store.
 */
function coerceSettings(raw: unknown): SettingsConfig {
  if (!raw || typeof raw !== 'object') throw new Error('settings must be an object');
  const s = raw as Partial<SettingsConfig>;
  if (typeof s.terminalTheme !== 'string') throw new Error('settings.terminalTheme must be string');
  if (typeof s.fontFamily !== 'string') throw new Error('settings.fontFamily must be string');
  if (typeof s.fontSize !== 'number' || !Number.isFinite(s.fontSize)) {
    throw new Error('settings.fontSize must be a number');
  }
  if (!s.keybindings || typeof s.keybindings !== 'object') {
    throw new Error('settings.keybindings must be an object');
  }
  const keybindings: Record<string, string> = {};
  for (const [k, v] of Object.entries(s.keybindings)) {
    if (typeof v === 'string') keybindings[k] = v;
  }
  return {
    terminalTheme: s.terminalTheme,
    fontFamily: s.fontFamily,
    fontSize: Math.max(
      MIN_TERMINAL_FONT_SIZE,
      Math.min(MAX_TERMINAL_FONT_SIZE, Math.round(s.fontSize)),
    ),
    keybindings,
  };
}

export interface ConfigIpcHooks {
  /** Called after settings are persisted, so the caller can rebuild the menu. */
  onSettingsChanged?: (settings: SettingsConfig) => void;
}

export function registerConfigIpc(
  store: ReposStore,
  hooks: ConfigIpcHooks = {},
): () => void {
  ipcMain.handle(Channels.ConfigGet, async () => store.get());

  ipcMain.handle(Channels.ConfigSetCodeRoot, async (_e, p: unknown) => {
    if (p !== null && typeof p !== 'string') throw new Error('codeRoot must be string|null');
    await store.setCodeRoot(p);
  });

  ipcMain.handle(Channels.ConfigSetSidebarCollapsed, async (_e, v: unknown) => {
    if (typeof v !== 'boolean') throw new Error('sidebarCollapsed must be boolean');
    await store.setSidebarCollapsed(v);
  });

  ipcMain.handle(Channels.ConfigSetSettings, async (_e, raw: unknown) => {
    const settings = coerceSettings(raw);
    await store.setSettings(settings);
    hooks.onSettingsChanged?.(settings);
  });

  return () => {
    ipcMain.removeHandler(Channels.ConfigGet);
    ipcMain.removeHandler(Channels.ConfigSetCodeRoot);
    ipcMain.removeHandler(Channels.ConfigSetSidebarCollapsed);
    ipcMain.removeHandler(Channels.ConfigSetSettings);
  };
}
