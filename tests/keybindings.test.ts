import { describe, expect, it } from 'vitest';
import {
  KEYBINDING_DEFS,
  findKeybindingConflicts,
  findReservedConflicts,
  normalizeAccelerator,
  resolveKeybindings,
} from '../src/shared/keybindings';

describe('resolveKeybindings', () => {
  it('returns factory defaults when there are no overrides', () => {
    const resolved = resolveKeybindings(undefined);
    for (const def of KEYBINDING_DEFS) {
      expect(resolved[def.command]).toBe(def.defaultAccelerator);
    }
  });

  it('applies user overrides over defaults', () => {
    const resolved = resolveKeybindings({ toggleSidebar: 'CmdOrCtrl+Shift+S' });
    expect(resolved.toggleSidebar).toBe('CmdOrCtrl+Shift+S');
    // Untouched commands keep their defaults.
    expect(resolved.toggleBrowser).toBe('CmdOrCtrl+Shift+B');
  });

  it('ignores blank/whitespace overrides and falls back to the default', () => {
    const resolved = resolveKeybindings({ toggleSidebar: '   ' });
    expect(resolved.toggleSidebar).toBe('CmdOrCtrl+B');
  });

  it('always returns an entry for every command in the table', () => {
    const resolved = resolveKeybindings({});
    expect(Object.keys(resolved).sort()).toEqual(
      KEYBINDING_DEFS.map((d) => d.command).sort(),
    );
  });
});

describe('normalizeAccelerator', () => {
  it('is modifier-order insensitive', () => {
    expect(normalizeAccelerator('Shift+CmdOrCtrl+B')).toBe(
      normalizeAccelerator('CmdOrCtrl+Shift+B'),
    );
  });

  it('treats Cmd / Ctrl / CmdOrCtrl as the same primary modifier', () => {
    expect(normalizeAccelerator('Cmd+B')).toBe(normalizeAccelerator('CmdOrCtrl+B'));
    expect(normalizeAccelerator('Ctrl+B')).toBe(normalizeAccelerator('Cmd+B'));
  });

  it('is case-insensitive on the key', () => {
    expect(normalizeAccelerator('CmdOrCtrl+b')).toBe(normalizeAccelerator('CmdOrCtrl+B'));
  });
});

describe('findKeybindingConflicts', () => {
  it('reports no conflicts for the factory defaults', () => {
    const resolved = resolveKeybindings(undefined);
    expect(findKeybindingConflicts(resolved)).toEqual([]);
  });

  it('detects a direct collision between two commands', () => {
    // Rebind toggleBrowser onto toggleSidebar's default chord.
    const resolved = resolveKeybindings({ toggleBrowser: 'CmdOrCtrl+B' });
    const conflicts = findKeybindingConflicts(resolved);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.commands.sort()).toEqual(['toggleBrowser', 'toggleSidebar']);
  });

  it('detects a collision even when accelerators differ only by alias / order', () => {
    // toggleSidebar default is CmdOrCtrl+B; rebind toggleBrowser to Cmd+B.
    const resolved = resolveKeybindings({ toggleBrowser: 'B+Cmd' });
    const conflicts = findKeybindingConflicts(resolved);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.commands).toContain('toggleSidebar');
    expect(conflicts[0]!.commands).toContain('toggleBrowser');
  });

  it('returns no conflict when all three commands have distinct chords', () => {
    const resolved = resolveKeybindings({
      toggleSidebar: 'CmdOrCtrl+1',
      toggleBrowser: 'CmdOrCtrl+2',
      openSettings: 'CmdOrCtrl+3',
    });
    expect(findKeybindingConflicts(resolved)).toEqual([]);
  });
});

describe('findReservedConflicts', () => {
  it('flags a binding that collides with a reserved system accelerator (Paste)', () => {
    const resolved = resolveKeybindings({ toggleSidebar: 'CmdOrCtrl+V' });
    const reserved = findReservedConflicts(resolved);
    expect(reserved).toHaveLength(1);
    expect(reserved[0]!.command).toBe('toggleSidebar');
    expect(reserved[0]!.reservedName).toBe('Paste');
  });

  it('matches reserved chords regardless of modifier alias/order', () => {
    // Cmd+C === CmdOrCtrl+C (Copy) after normalization.
    const resolved = resolveKeybindings({ openSettings: 'C+Cmd' });
    const reserved = findReservedConflicts(resolved);
    expect(reserved.map((r) => r.reservedName)).toContain('Copy');
  });

  it('returns nothing when bindings avoid reserved chords', () => {
    const resolved = resolveKeybindings({
      toggleSidebar: 'CmdOrCtrl+1',
      toggleBrowser: 'CmdOrCtrl+Shift+B',
      openSettings: 'CmdOrCtrl+,',
    });
    expect(findReservedConflicts(resolved)).toEqual([]);
  });
});
