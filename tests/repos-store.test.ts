import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ReposStore } from '../src/main/repos-store';

describe('ReposStore', () => {
  let dir: string;
  let configPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'treeline-cfg-'));
    configPath = join(dir, 'config.json');
  });

  afterEach(() => {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it('load() returns defaults when file is missing', () => {
    const store = new ReposStore(configPath);
    const cfg = store.load();
    expect(cfg.repos).toEqual([]);
    expect(cfg.codeRoot).toBeNull();
    expect(cfg.sidebarCollapsed).toBe(false);
    expect(cfg.dismissedRepos).toEqual([]);
    expect(cfg.settings.terminalTheme).toBe('graphite');
    expect(cfg.settings.fontSize).toBe(13);
    expect(cfg.settings.keybindings).toEqual({});
    expect(cfg.schemaVersion).toBe(4);
  });

  it('addRepo + removeRepo round-trips through disk', async () => {
    const a = new ReposStore(configPath);
    a.load();
    await a.addRepo('/Users/me/code/foo');
    await a.addRepo('/Users/me/code/bar');

    // Reload from disk in a fresh instance.
    const b = new ReposStore(configPath);
    const cfg = b.load();
    expect(cfg.repos.map((r) => r.path)).toEqual([
      '/Users/me/code/foo',
      '/Users/me/code/bar',
    ]);
    expect(cfg.repos[0]?.name).toBe('foo');

    await b.removeRepo('/Users/me/code/foo');
    const c = new ReposStore(configPath);
    expect(c.load().repos.map((r) => r.path)).toEqual(['/Users/me/code/bar']);
  });

  it('addRepo is idempotent for the same path', async () => {
    const store = new ReposStore(configPath);
    store.load();
    const first = await store.addRepo('/Users/me/code/foo');
    const second = await store.addRepo('/Users/me/code/foo');
    expect(first).toEqual(second);
    expect(store.get().repos).toHaveLength(1);
  });

  it('load() defaults folders to [] when file is missing', () => {
    expect(new ReposStore(configPath).load().folders).toEqual([]);
  });

  it('addFolder + removeFolder round-trips through disk and is idempotent', async () => {
    const a = new ReposStore(configPath);
    a.load();
    const first = await a.addFolder('/Users/me/.claude/commands');
    const second = await a.addFolder('/Users/me/.claude/commands'); // dup
    expect(first).toEqual(second);
    await a.addFolder('/Users/me/notes');

    const b = new ReposStore(configPath);
    const cfg = b.load();
    expect(cfg.folders.map((f) => f.path)).toEqual([
      '/Users/me/.claude/commands',
      '/Users/me/notes',
    ]);
    expect(cfg.folders[0]?.name).toBe('commands');

    await b.removeFolder('/Users/me/.claude/commands');
    const c = new ReposStore(configPath);
    expect(c.load().folders.map((f) => f.path)).toEqual(['/Users/me/notes']);
  });

  it('migrates a pre-v4 config (no folders field) by defaulting to []', () => {
    writeFileSync(
      configPath,
      JSON.stringify({
        repos: [{ path: '/x', name: 'x', addedAt: 100 }],
        codeRoot: null,
        sidebarCollapsed: false,
        dismissedRepos: [],
        schemaVersion: 3,
      }),
    );
    const cfg = new ReposStore(configPath).load();
    expect(cfg.folders).toEqual([]);
    expect(cfg.repos).toHaveLength(1);
    expect(cfg.schemaVersion).toBe(4);
  });

  it('setSidebarCollapsed persists across reloads', async () => {
    const a = new ReposStore(configPath);
    a.load();
    await a.setSidebarCollapsed(true);
    const b = new ReposStore(configPath);
    expect(b.load().sidebarCollapsed).toBe(true);
  });

  it('setSettings persists terminal theme/font + keybindings across reloads', async () => {
    const a = new ReposStore(configPath);
    a.load();
    await a.setSettings({
      terminalTheme: 'midnight',
      fontFamily: 'Fira Code, monospace',
      fontSize: 16,
      keybindings: { toggleSidebar: 'CmdOrCtrl+Shift+B' },
    });
    const b = new ReposStore(configPath);
    const cfg = b.load();
    expect(cfg.settings.terminalTheme).toBe('midnight');
    expect(cfg.settings.fontFamily).toBe('Fira Code, monospace');
    expect(cfg.settings.fontSize).toBe(16);
    expect(cfg.settings.keybindings).toEqual({ toggleSidebar: 'CmdOrCtrl+Shift+B' });
  });

  it('survives a corrupt config file by falling back to defaults', () => {
    writeFileSync(configPath, '{not valid json');
    const store = new ReposStore(configPath);
    const cfg = store.load();
    expect(cfg.repos).toEqual([]);
    expect(cfg.schemaVersion).toBe(4);
  });

  it('migrates a partial config (missing keys) without losing data', () => {
    writeFileSync(
      configPath,
      JSON.stringify({
        repos: [{ path: '/x', name: 'x', addedAt: 100 }],
        // codeRoot, sidebarCollapsed, dismissedRepos, schemaVersion all missing
      }),
    );
    const store = new ReposStore(configPath);
    const cfg = store.load();
    expect(cfg.repos).toHaveLength(1);
    expect(cfg.codeRoot).toBeNull();
    expect(cfg.sidebarCollapsed).toBe(false);
    expect(cfg.dismissedRepos).toEqual([]);
    expect(cfg.settings.terminalTheme).toBe('graphite');
    expect(cfg.schemaVersion).toBe(4);
  });

  it('dismissRepo persists across reloads and is idempotent', async () => {
    const a = new ReposStore(configPath);
    a.load();
    await a.dismissRepo('/Users/me/scratch');
    await a.dismissRepo('/Users/me/scratch'); // dup
    await a.dismissRepo('/Users/me/other');
    const b = new ReposStore(configPath);
    expect(b.load().dismissedRepos).toEqual([
      '/Users/me/scratch',
      '/Users/me/other',
    ]);
  });

  it('migrates a v1 config (no dismissedRepos field) by defaulting to []', () => {
    writeFileSync(
      configPath,
      JSON.stringify({
        repos: [{ path: '/x', name: 'x', addedAt: 100 }],
        codeRoot: null,
        sidebarCollapsed: true,
        schemaVersion: 1,
      }),
    );
    const store = new ReposStore(configPath);
    const cfg = store.load();
    expect(cfg.dismissedRepos).toEqual([]);
    expect(cfg.sidebarCollapsed).toBe(true);
    expect(cfg.settings.terminalTheme).toBe('graphite');
    expect(cfg.settings.keybindings).toEqual({});
    expect(cfg.schemaVersion).toBe(4);
  });

  it('writes atomically — the tmp file is never left behind on success', async () => {
    const store = new ReposStore(configPath);
    store.load();
    await store.addRepo('/x');
    // Read everything in dir; only config.json (and parent .) should remain.
    const fs = await import('node:fs/promises');
    const entries = await fs.readdir(dir);
    expect(entries).toEqual(['config.json']);
    const raw = readFileSync(configPath, 'utf8');
    expect(JSON.parse(raw).repos[0].path).toBe('/x');
  });
});
