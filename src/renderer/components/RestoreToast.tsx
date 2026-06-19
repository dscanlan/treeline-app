import { useEffect } from 'react';
import { useStore } from '../store';

/** How long the "session restored" notice stays up before auto-dismissing. */
const DISMISS_MS = 5000;

/**
 * Transient confirmation shown after a cold-start restore respawns the saved
 * tabs (see actions/tabs.ts `restoreSession`). Reports how many tabs came back
 * and, when relevant, how many were skipped because their worktree had been
 * removed while the app was closed — so a missing tab reads as "that worktree is
 * gone" rather than a silent failure. Informational only; auto-dismisses.
 */
export function RestoreToast() {
  const notice = useStore((s) => s.restoreNotice);
  const clear = useStore((s) => s.clearRestoreNotice);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(clear, DISMISS_MS);
    return () => window.clearTimeout(t);
  }, [notice, clear]);

  if (!notice) return null;
  const { count, skipped } = notice;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed left-1/2 top-4 z-40 -translate-x-1/2 rounded border border-treeline-highlight bg-treeline-surface px-3 py-1.5 text-xs text-treeline-dim shadow-2xl"
    >
      <span className="text-treeline-cyan">↻ Restored {count}</span>{' '}
      {count === 1 ? 'tab' : 'tabs'}
      {skipped > 0 && (
        <span className="text-treeline-dim">
          {' '}
          ({skipped} skipped — worktree removed)
        </span>
      )}
    </div>
  );
}
