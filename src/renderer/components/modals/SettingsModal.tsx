import { useMemo, useState } from 'react';
import type { SettingsConfig } from '@shared/types';
import {
  EXTERNAL_THEME_SOURCES,
  MAX_TERMINAL_FONT_SIZE,
  MIN_TERMINAL_FONT_SIZE,
  TERMINAL_THEME_PRESETS,
} from '@shared/terminal-theme';
import {
  KEYBINDING_DEFS,
  findKeybindingConflicts,
  findReservedConflicts,
  resolveKeybindings,
  type KeybindingCommand,
} from '@shared/keybindings';
import { useStore } from '../../store';
import { ModalShell } from './ModalShell';

/**
 * Settings: terminal theme + font, and customizable keybindings. Edits a local
 * draft so the user can cancel; "Save" validates for keybinding conflicts,
 * persists via `config.setSettings`, and pushes the draft into the store (which
 * the live xterm theme effect picks up). Conflicts are shown inline and block
 * saving.
 */
export function SettingsModal() {
  const closeModal = useStore((s) => s.closeModal);
  const current = useStore((s) => s.settings);
  const applySettings = useStore((s) => s.setSettings);

  const [draft, setDraft] = useState<SettingsConfig>(() => ({
    ...current,
    keybindings: { ...current.keybindings },
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The effective (resolved) accelerator for each command in the draft, and any
  // conflicts among them. Recomputed as the user types.
  const resolved = useMemo(
    () => resolveKeybindings(draft.keybindings),
    [draft.keybindings],
  );
  const conflicts = useMemo(() => findKeybindingConflicts(resolved), [resolved]);
  const reservedConflicts = useMemo(() => findReservedConflicts(resolved), [resolved]);
  const hasBlockingConflict = conflicts.length > 0 || reservedConflicts.length > 0;
  const conflictedCommands = useMemo(() => {
    const set = new Set<KeybindingCommand>();
    for (const c of conflicts) for (const cmd of c.commands) set.add(cmd);
    for (const r of reservedConflicts) set.add(r.command);
    return set;
  }, [conflicts, reservedConflicts]);

  const setKeybinding = (command: KeybindingCommand, value: string) => {
    setDraft((d) => ({ ...d, keybindings: { ...d.keybindings, [command]: value } }));
  };

  const onSave = async () => {
    setError(null);
    if (hasBlockingConflict) {
      setError('Resolve keybinding conflicts before saving.');
      return;
    }
    setBusy(true);
    try {
      await window.treeline.config.setSettings(draft);
      applySettings(draft);
      closeModal();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell title="Settings" onClose={closeModal}>
      <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto">
        {/* ── Appearance (app-wide theme) ─────────────────────────────── */}
        <section className="flex flex-col gap-2">
          <h3 className="text-xs uppercase tracking-wide text-treeline-dim">Appearance</h3>

          <label className="flex flex-col gap-1 text-xs text-treeline-dim">
            Theme
            <select
              value={draft.terminalTheme}
              onChange={(e) => setDraft((d) => ({ ...d, terminalTheme: e.target.value }))}
              className="rounded bg-treeline-highlight px-2 py-1 text-treeline-text focus:outline-none focus:ring-1 focus:ring-treeline-cyan"
            >
              {TERMINAL_THEME_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <p className="text-[11px] text-treeline-dim">
            Applies to the whole app — chrome and terminals.
          </p>
        </section>

        {/* ── Terminal ────────────────────────────────────────────────── */}
        <section className="flex flex-col gap-2">
          <h3 className="text-xs uppercase tracking-wide text-treeline-dim">Terminal</h3>

          <label className="flex flex-col gap-1 text-xs text-treeline-dim">
            Font family
            <input
              type="text"
              value={draft.fontFamily}
              onChange={(e) => setDraft((d) => ({ ...d, fontFamily: e.target.value }))}
              placeholder="ui-monospace, Menlo, monospace"
              className="rounded bg-treeline-highlight px-2 py-1 font-mono text-treeline-text focus:outline-none focus:ring-1 focus:ring-treeline-cyan"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs text-treeline-dim">
            Font size ({draft.fontSize}px)
            <input
              type="range"
              min={MIN_TERMINAL_FONT_SIZE}
              max={MAX_TERMINAL_FONT_SIZE}
              value={draft.fontSize}
              onChange={(e) =>
                setDraft((d) => ({ ...d, fontSize: Number(e.target.value) }))
              }
            />
          </label>

          {/* Stubbed external-config import hook — v1 does not parse these. */}
          <div className="text-[11px] text-treeline-dim">
            Import from{' '}
            {EXTERNAL_THEME_SOURCES.map((s) => s.label.split(' ')[0]).join(' / ')}{' '}
            <span className="italic">(coming soon)</span>
          </div>
        </section>

        {/* ── Notes ──────────────────────────────────────────────────── */}
        <section className="flex flex-col gap-2">
          <h3 className="text-xs uppercase tracking-wide text-treeline-dim">Notes</h3>

          <label className="flex flex-col gap-1 text-xs text-treeline-dim">
            Vault folder
            <input
              type="text"
              value={draft.vaultPath ?? ''}
              onChange={(e) =>
                setDraft((d) => ({ ...d, vaultPath: e.target.value.trim() || null }))
              }
              placeholder="/absolute/path/to/your/notes"
              spellCheck={false}
              className="rounded bg-treeline-highlight px-2 py-1 font-mono text-treeline-text focus:outline-none focus:ring-1 focus:ring-treeline-cyan"
            />
          </label>
          <p className="text-[11px] text-treeline-dim">
            Root for resolving [[wikilinks]] in markdown previews — any folder of markdown
            notes. Leave empty to resolve within the containing pinned repo or folder.
          </p>
        </section>

        {/* ── Keybindings ────────────────────────────────────────────── */}
        <section className="flex flex-col gap-2">
          <h3 className="text-xs uppercase tracking-wide text-treeline-dim">Keybindings</h3>
          <div className="flex flex-col gap-2">
            {KEYBINDING_DEFS.map((def) => {
              const conflicted = conflictedCommands.has(def.command);
              return (
                <label
                  key={def.command}
                  className="flex items-center justify-between gap-3 text-xs text-treeline-text"
                >
                  <span>{def.label}</span>
                  <input
                    type="text"
                    value={resolved[def.command]}
                    onChange={(e) => setKeybinding(def.command, e.target.value)}
                    spellCheck={false}
                    className={`w-44 rounded bg-treeline-highlight px-2 py-1 font-mono text-treeline-text focus:outline-none focus:ring-1 ${
                      conflicted
                        ? 'ring-1 ring-treeline-red focus:ring-treeline-red'
                        : 'focus:ring-treeline-cyan'
                    }`}
                  />
                </label>
              );
            })}
          </div>
          <p className="text-[11px] text-treeline-dim">
            Electron accelerator syntax, e.g. <code>CmdOrCtrl+Shift+L</code>.
          </p>
          {(conflicts.length > 0 || reservedConflicts.length > 0) && (
            <div className="text-xs text-treeline-red">
              {conflicts.map((c) => (
                <div key={c.accelerator}>
                  Conflict: {c.commands.join(' + ')} share the same shortcut.
                </div>
              ))}
              {reservedConflicts.map((r) => (
                <div key={r.command}>
                  {r.accelerator} is reserved by {r.reservedName} — pick another.
                </div>
              ))}
            </div>
          )}
        </section>

        {error && <div className="text-xs text-treeline-red">{error}</div>}

        <div className="mt-1 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={closeModal}
            className="rounded px-3 py-1 text-treeline-dim hover:text-treeline-text"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void onSave()}
            disabled={busy || hasBlockingConflict}
            className="rounded bg-treeline-cyan px-3 py-1 text-treeline-surface disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
