// Tab-orchestration helpers shared by Sidebar clicks, the + button, and the
// close button. Keeps the IPC dance out of the components.
import { useStore } from '../store';

interface OpenOpts {
  /** If true, always spawn a fresh tab instead of focusing the MRU on this cwd. */
  forceNew?: boolean;
}

export async function openTabAt(cwd: string, opts: OpenOpts = {}): Promise<void> {
  const s = useStore.getState();
  const existing = s.tabsByCwd[cwd]?.[0];
  if (!opts.forceNew && existing) {
    s.setActive(existing);
    s.setSelected(cwd);
    return;
  }
  // Spawn a new PTY in the main process. Initial size is updated by FitAddon
  // immediately after mount, so the 80x24 default is fine.
  const { id } = await window.treeline.pty.spawn({ cwd, cols: 80, rows: 24 });
  s.addTab({ ptyId: id, cwd });
  s.setSelected(cwd);
}

export async function closeTab(id: string): Promise<void> {
  const s = useStore.getState();
  s.removeTab(id);
  // Best-effort PTY kill; ignore errors (already exited).
  try {
    await window.treeline.pty.kill(id);
  } catch {
    /* ignore */
  }
}
