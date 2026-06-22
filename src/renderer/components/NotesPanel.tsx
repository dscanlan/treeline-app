import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { copyToClipboard } from '../util/clipboard';

/**
 * The scratchpad panel beside the terminal: a single, always-available
 * plain-text buffer for the quick copy → clean → paste loop (paste messy agent
 * output, delete the irrelevant bits, copy the clean result into another chat),
 * without leaving treeline for a text editor.
 *
 * The text is bound to the store and persisted to `scratchpad.json`. Mid-typing
 * persistence is the debounced save in renderer/ipc/client.ts; this component
 * also flushes immediately on blur so an edit isn't lost if the app closes
 * before the debounce fires.
 */
export function NotesPanel() {
  const text = useStore((s) => s.scratchpadText);
  const setText = useStore((s) => s.setScratchpadText);
  const closeNotesPanel = useStore((s) => s.closeNotesPanel);

  const [copied, setCopied] = useState(false);
  // Clear is confirmable (it deletes persisted content): the first click arms
  // it, a second within the window commits, otherwise it disarms itself.
  const [confirmClear, setConfirmClear] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
    },
    [],
  );

  const onCopy = async () => {
    const ok = await copyToClipboard(text);
    if (!ok) return;
    setCopied(true);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 1500);
  };

  const onClear = () => {
    if (!confirmClear) {
      setConfirmClear(true);
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
      confirmTimer.current = setTimeout(() => setConfirmClear(false), 3000);
      return;
    }
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    setConfirmClear(false);
    setText('');
  };

  // Persist immediately on blur so the final edit survives an imminent quit
  // (the debounced save in client.ts may not have fired yet).
  const onBlur = () => {
    void window.treeline.scratchpad.set(text);
  };

  return (
    <section className="flex h-full min-w-0 flex-col bg-treeline-surface">
      <header className="flex shrink-0 items-center gap-2 border-b border-treeline-highlight px-3 py-1.5">
        <span className="min-w-0 flex-1 truncate text-xs text-treeline-text">Scratchpad</span>

        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={() => void onCopy()}
            disabled={text.length === 0}
            title="Copy all to clipboard"
            className="rounded px-1.5 py-0.5 text-[11px] text-treeline-dim hover:bg-treeline-highlight hover:text-treeline-text disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-treeline-dim"
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button
            type="button"
            onClick={onClear}
            disabled={text.length === 0}
            title={confirmClear ? 'Click again to clear the scratchpad' : 'Clear the scratchpad'}
            className={`rounded px-1.5 py-0.5 text-[11px] disabled:opacity-40 disabled:hover:bg-transparent ${
              confirmClear
                ? 'text-treeline-red hover:bg-treeline-highlight'
                : 'text-treeline-dim hover:bg-treeline-highlight hover:text-treeline-text'
            }`}
          >
            {confirmClear ? 'Confirm?' : 'Clear'}
          </button>
          <button
            type="button"
            onClick={closeNotesPanel}
            title="Close scratchpad"
            aria-label="Close scratchpad"
            className="rounded px-1 text-treeline-dim hover:bg-treeline-highlight hover:text-treeline-red"
          >
            ×
          </button>
        </div>
      </header>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={onBlur}
        spellCheck={false}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        placeholder="Paste, edit, copy out…"
        aria-label="Scratchpad"
        className="min-h-0 flex-1 resize-none bg-transparent px-3 py-2 text-[13px] leading-relaxed text-treeline-text placeholder:text-treeline-dim focus:outline-none"
        style={{ fontFamily: 'var(--treeline-font-mono)' }}
      />
    </section>
  );
}
