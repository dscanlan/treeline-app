import { useState } from 'react';
import { openScratchTerminal } from '../actions/scratch';

/**
 * Sidebar button that spawns a scratch terminal in the user's home dir. The
 * busy-state guard prevents a double-click from racing two PTY spawns; the
 * action itself is idempotent against repeat invocations but the visual
 * "Spawning…" feedback is worth having.
 */
export function ScratchTerminalButton() {
  const [busy, setBusy] = useState(false);

  const onClick = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await openScratchTerminal();
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      title="Open a scratch terminal in your home directory"
      className="rounded border border-treeline-highlight px-2 py-1 text-treeline-text hover:bg-treeline-highlight disabled:opacity-50"
    >
      {busy ? 'Spawning…' : '>_ Scratch'}
    </button>
  );
}
