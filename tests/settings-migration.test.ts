import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ReposStore } from '../src/main/repos-store';

// Migration coverage for the schemaVersion 3 `settings` field. The store is the
// single migration owner; these tests pin the old-config → new-defaults behavior
// so a future schema bump can't silently drop settings.
describe('settings migration (schemaVersion 3)', () => {
  let dir: string;
  let configPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'treeline-settings-'));
    configPath = join(dir, 'config.json');
  });

  afterEach(() => {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it('default-fills settings for a pre-v3 config that has no settings key', () => {
    writeFileSync(
      configPath,
      JSON.stringify({
        repos: [{ path: '/x', name: 'x', addedAt: 1 }],
        codeRoot: null,
        sidebarCollapsed: false,
        dismissedRepos: [],
        schemaVersion: 2,
      }),
    );
    const cfg = new ReposStore(configPath).load();
    expect(cfg.schemaVersion).toBe(3);
    expect(cfg.settings).toEqual({
      terminalTheme: 'graphite',
      fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
      fontSize: 13,
      keybindings: {},
    });
  });

  it('preserves valid settings fields and fills the rest', () => {
    writeFileSync(
      configPath,
      JSON.stringify({
        repos: [],
        settings: {
          terminalTheme: 'midnight',
          fontSize: 18,
          keybindings: { toggleBrowser: 'CmdOrCtrl+Shift+K' },
          // fontFamily intentionally missing
        },
        schemaVersion: 3,
      }),
    );
    const cfg = new ReposStore(configPath).load();
    expect(cfg.settings.terminalTheme).toBe('midnight');
    expect(cfg.settings.fontSize).toBe(18);
    expect(cfg.settings.keybindings).toEqual({ toggleBrowser: 'CmdOrCtrl+Shift+K' });
    // Missing field defaulted.
    expect(cfg.settings.fontFamily).toContain('ui-monospace');
  });

  it('drops malformed settings fields and non-string keybinding values', () => {
    writeFileSync(
      configPath,
      JSON.stringify({
        repos: [],
        settings: {
          terminalTheme: 42, // wrong type → default
          fontFamily: '', // empty → default
          fontSize: 'big', // wrong type → default
          keybindings: { toggleSidebar: 'CmdOrCtrl+B', bogus: 99 },
        },
        schemaVersion: 3,
      }),
    );
    const cfg = new ReposStore(configPath).load();
    expect(cfg.settings.terminalTheme).toBe('graphite');
    expect(cfg.settings.fontFamily).toContain('ui-monospace');
    expect(cfg.settings.fontSize).toBe(13);
    // Only the string-valued override survives.
    expect(cfg.settings.keybindings).toEqual({ toggleSidebar: 'CmdOrCtrl+B' });
  });

  it('an unknown theme id survives migration (resolution layer degrades it)', () => {
    writeFileSync(
      configPath,
      JSON.stringify({
        repos: [],
        settings: { terminalTheme: 'solarized-from-the-future', fontFamily: 'X', fontSize: 12, keybindings: {} },
        schemaVersion: 3,
      }),
    );
    const cfg = new ReposStore(configPath).load();
    // Stored loosely; the renderer's themeForId() falls back to default at use.
    expect(cfg.settings.terminalTheme).toBe('solarized-from-the-future');
  });

  it('a corrupt config falls back to default settings', () => {
    writeFileSync(configPath, '{ broken');
    const cfg = new ReposStore(configPath).load();
    expect(cfg.schemaVersion).toBe(3);
    expect(cfg.settings.keybindings).toEqual({});
  });
});
