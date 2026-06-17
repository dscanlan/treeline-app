// Central command table for treeline-app's customizable keybindings.
//
// This is the single source of truth for every rebindable accelerator. Both the
// main process (menu.ts builds its accelerators from `resolveKeybindings()`) and
// the renderer (non-menu key handlers) read the same resolved map, so a binding
// only ever lives in one place.
//
// Accelerators use Electron's accelerator syntax (e.g. "CmdOrCtrl+B",
// "CmdOrCtrl+Shift+L"). Keeping the strings in Electron's vocabulary means the
// menu can pass them straight through; the renderer matches against them via the
// small parser below.
//
// Pure module (no Electron / DOM imports) so it can be imported by main,
// renderer, AND unit-tested in the node tsconfig.

/** A stable, machine-readable id for each rebindable command. */
export type KeybindingCommand =
  | 'toggleSidebar'
  | 'toggleBrowser'
  | 'openSettings';

/** One row of the central command table. */
export interface KeybindingDef {
  /** Stable id used as the persistence key and the menu wiring key. */
  command: KeybindingCommand;
  /** Human label shown in the Settings UI. */
  label: string;
  /** Factory default accelerator in Electron accelerator syntax. */
  defaultAccelerator: string;
}

/**
 * The factory command table. Order is the display order in Settings. Append new
 * commands here; never reorder existing rows in a way that changes their
 * `command` id (the id is the persistence key).
 */
export const KEYBINDING_DEFS: readonly KeybindingDef[] = [
  {
    command: 'toggleSidebar',
    label: 'Toggle Sidebar',
    defaultAccelerator: 'CmdOrCtrl+B',
  },
  {
    command: 'toggleBrowser',
    label: 'Toggle Browser',
    defaultAccelerator: 'CmdOrCtrl+Shift+B',
  },
  {
    command: 'openSettings',
    label: 'Open Settings',
    defaultAccelerator: 'CmdOrCtrl+,',
  },
] as const;

/** User overrides persisted in config: command id → accelerator string. */
export type KeybindingOverrides = Partial<Record<KeybindingCommand, string>>;

/** A fully resolved binding map: every command id → its effective accelerator. */
export type ResolvedKeybindings = Record<KeybindingCommand, string>;

/**
 * Merge user overrides over the factory defaults. Unknown override keys are
 * ignored; missing commands fall back to their default. The result always has an
 * entry for every command in `KEYBINDING_DEFS`.
 */
export function resolveKeybindings(
  overrides: KeybindingOverrides | null | undefined,
): ResolvedKeybindings {
  const out = {} as ResolvedKeybindings;
  for (const def of KEYBINDING_DEFS) {
    const override = overrides?.[def.command];
    out[def.command] =
      typeof override === 'string' && override.trim().length > 0
        ? override.trim()
        : def.defaultAccelerator;
  }
  return out;
}

/** A conflict: two or more commands resolve to the same normalized accelerator. */
export interface KeybindingConflict {
  /** The normalized accelerator string shared by the conflicting commands. */
  accelerator: string;
  /** The commands that collide on it (≥2). */
  commands: KeybindingCommand[];
}

/**
 * Normalize an accelerator for comparison: case-insensitive, modifier-order
 * insensitive, and treating the `Cmd`/`Command`/`Ctrl`/`Control`/`CmdOrCtrl`
 * aliases as equivalent. Two accelerators that fire on the same physical chord
 * normalize to the same string.
 */
export function normalizeAccelerator(accelerator: string): string {
  const parts = accelerator
    .split('+')
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => canonicalToken(p));

  const mods = parts.filter(isModifier).sort();
  const keys = parts.filter((p) => !isModifier(p));
  return [...mods, ...keys].join('+');
}

function canonicalToken(token: string): string {
  const lower = token.toLowerCase();
  switch (lower) {
    // Treat all "primary modifier" aliases as one token so e.g. "Cmd+B" on mac
    // collides with "CmdOrCtrl+B".
    case 'cmd':
    case 'command':
    case 'ctrl':
    case 'control':
    case 'cmdorctrl':
    case 'commandorcontrol':
      return 'mod';
    case 'option':
    case 'alt':
      return 'alt';
    case 'shift':
      return 'shift';
    case 'super':
    case 'meta':
      return 'super';
    default:
      return lower;
  }
}

function isModifier(token: string): boolean {
  return token === 'mod' || token === 'alt' || token === 'shift' || token === 'super';
}

/**
 * Find every accelerator collision in a resolved keybinding map. Returns one
 * `KeybindingConflict` per distinct accelerator that ≥2 commands share. Empty
 * array means the map is conflict-free.
 */
export function findKeybindingConflicts(
  resolved: ResolvedKeybindings,
): KeybindingConflict[] {
  const byAccel = new Map<string, KeybindingCommand[]>();
  for (const def of KEYBINDING_DEFS) {
    const accel = resolved[def.command];
    if (!accel) continue;
    const norm = normalizeAccelerator(accel);
    const list = byAccel.get(norm);
    if (list) list.push(def.command);
    else byAccel.set(norm, [def.command]);
  }
  const conflicts: KeybindingConflict[] = [];
  for (const [accelerator, commands] of byAccel) {
    if (commands.length > 1) conflicts.push({ accelerator, commands });
  }
  return conflicts;
}

/**
 * System accelerators owned by the built-in app/Edit/View menu roles (Paste,
 * Copy, Quit, …). A user binding that collides with one of these never fires —
 * the role wins — so the Settings UI must reject them. `findKeybindingConflicts`
 * only checks our own commands against each other; this catches collisions with
 * Electron's reserved menu shortcuts. Keyed by normalized accelerator.
 */
export const RESERVED_ACCELERATORS: ReadonlyMap<string, string> = new Map(
  (
    [
      ['CmdOrCtrl+Z', 'Undo'],
      ['CmdOrCtrl+Shift+Z', 'Redo'],
      ['CmdOrCtrl+X', 'Cut'],
      ['CmdOrCtrl+C', 'Copy'],
      ['CmdOrCtrl+V', 'Paste'],
      ['CmdOrCtrl+A', 'Select All'],
      ['CmdOrCtrl+Q', 'Quit'],
      ['CmdOrCtrl+W', 'Close Window'],
      ['CmdOrCtrl+M', 'Minimize'],
      ['CmdOrCtrl+H', 'Hide'],
      ['CmdOrCtrl+R', 'Reload'],
      ['CmdOrCtrl+Shift+R', 'Force Reload'],
      ['CmdOrCtrl+0', 'Reset Zoom'],
      ['CmdOrCtrl+Plus', 'Zoom In'],
      ['CmdOrCtrl+-', 'Zoom Out'],
    ] as const
  ).map(([accel, name]) => [normalizeAccelerator(accel), name]),
);

/** A user binding colliding with a reserved system accelerator. */
export interface ReservedConflict {
  command: KeybindingCommand;
  /** The user's accelerator (as entered). */
  accelerator: string;
  /** Name of the system action that owns this chord (e.g. "Paste"). */
  reservedName: string;
}

/**
 * Find resolved bindings that collide with a reserved system accelerator
 * (`RESERVED_ACCELERATORS`). These can't fire because the built-in menu role
 * owns the chord, so the Settings UI surfaces them and blocks saving.
 */
export function findReservedConflicts(
  resolved: ResolvedKeybindings,
): ReservedConflict[] {
  const out: ReservedConflict[] = [];
  for (const def of KEYBINDING_DEFS) {
    const accel = resolved[def.command];
    if (!accel) continue;
    const reservedName = RESERVED_ACCELERATORS.get(normalizeAccelerator(accel));
    if (reservedName) {
      out.push({ command: def.command, accelerator: accel, reservedName });
    }
  }
  return out;
}
