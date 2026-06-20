// Scratch-terminal orchestration. Spawns a PTY in the user's home dir, hooks
// it into the tabs slice with a "Scratch N" title, and registers an
// auto-cleanup listener so the sidebar row and tab vanish when the shell
// exits (whether via `exit` typed at the prompt or the user closing the tab).
import { useStore } from '../store';

/**
 * Open a new scratch terminal. Each call spawns a fresh PTY — there's no
 * "reuse existing scratch" path because the user just clicked the button
 * specifically to get another one.
 */
export async function openScratchTerminal(): Promise<void> {
  const s = useStore.getState();
  const home = window.treeline.system.homeDir;
  const n = s.nextScratchNumber();
  const label = `Scratch ${n}`;

  const { id } = await window.treeline.pty.spawn({ cwd: home, cols: 80, rows: 24 });
  s.addScratch({ id, label, ptyId: id, cwd: home, createdAt: Date.now() });
  s.addTab({ ptyId: id, cwd: home, title: label });
  s.setSelectedScratch(id);
  registerScratchCleanup(id);
}

/**
 * Wire a scratch PTY's auto-cleanup: when the shell exits — either the user
 * typed `exit`, or the tab's × button killed the PTY via closeTab() — strip the
 * scratch row and its tab from the store. Both removal calls are idempotent so a
 * closeTab() → kill → exit chain doesn't double-remove. Shared by
 * `openScratchTerminal` and `restoreSession` (which re-seeds scratch rows after
 * a full restart), so a restored scratch tears down exactly like a fresh one.
 */
export function registerScratchCleanup(ptyId: string): void {
  const off = window.treeline.pty.onExit(ptyId, () => {
    const st = useStore.getState();
    st.removeScratchById(ptyId);
    st.removeTab(ptyId);
    if (st.selectedScratchId === ptyId) st.setSelectedScratch(null);
    off();
  });
}
