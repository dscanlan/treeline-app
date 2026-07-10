import type { StateCreator } from 'zustand';
import type { SettingsConfig } from '@shared/types';
import {
  DEFAULT_TERMINAL_FONT_FAMILY,
  DEFAULT_TERMINAL_FONT_SIZE,
  DEFAULT_TERMINAL_THEME_ID,
} from '@shared/terminal-theme';
import { resolveKeybindings, type ResolvedKeybindings } from '@shared/keybindings';

/**
 * Renderer-side mirror of the persisted `AppConfig.settings`, plus the derived
 * resolved keybinding map. `loadInitialState()` seeds it from config; the
 * SettingsModal updates it (optimistically) and persists via
 * `config.setSettings`. xterm reads `settings.terminalTheme/fontFamily/fontSize`
 * through this slice.
 */
export interface SettingsSlice {
  settings: SettingsConfig;
  /** Derived from `settings.keybindings` — every command id → effective accel. */
  resolvedKeybindings: ResolvedKeybindings;
  /** Replace the whole settings object (and recompute the resolved map). */
  setSettings: (settings: SettingsConfig) => void;
}

/** Factory-default settings — mirrors repos-store's DEFAULT_SETTINGS. */
export const DEFAULT_RENDERER_SETTINGS: SettingsConfig = {
  terminalTheme: DEFAULT_TERMINAL_THEME_ID,
  fontFamily: DEFAULT_TERMINAL_FONT_FAMILY,
  fontSize: DEFAULT_TERMINAL_FONT_SIZE,
  keybindings: {},
  vaultPath: null,
};

export const createSettingsSlice: StateCreator<SettingsSlice, [], [], SettingsSlice> = (
  set,
) => ({
  settings: { ...DEFAULT_RENDERER_SETTINGS },
  resolvedKeybindings: resolveKeybindings(DEFAULT_RENDERER_SETTINGS.keybindings),
  setSettings: (settings) =>
    set({ settings, resolvedKeybindings: resolveKeybindings(settings.keybindings) }),
});
