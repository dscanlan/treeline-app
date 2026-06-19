import { useEffect } from 'react';
import { useStore } from '../store';

/** How long the "terminals restored" notice stays up before auto-dismissing. */
const DISMISS_MS = 4000;

/**
 * Transient top-center status shown after a reload re-adopts the terminals that
 * survived in the main process (see ipc/client.ts `reattachPtys`). It tells the
 * user their sessions are being restored — without it the panes briefly sit
 * blank while each xterm replays its buffer, reading as a hang or a crash.
 * Auto-dismisses; informational only (no action), so it's distinct from the
 * bottom-right action toasts.
 */
export function ReattachToast() {
  const notice = useStore((s) => s.reattachNotice);
  const clear = useStore((s) => s.clearReattachNotice);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(clear, DISMISS_MS);
    return () => window.clearTimeout(t);
  }, [notice, clear]);

  if (!notice) return null;
  const { count } = notice;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed left-1/2 top-4 z-40 -translate-x-1/2 rounded border border-treeline-highlight bg-treeline-surface px-3 py-1.5 text-xs text-treeline-dim shadow-2xl"
    >
      <span className="text-treeline-cyan">↻ Restored {count}</span>{' '}
      {count === 1 ? 'terminal' : 'terminals'} after reload
    </div>
  );
}
