import { webContents } from 'electron';
import { Channels } from '@shared/ipc-channels';
import type { TerminalStatusUpdate } from '@shared/types';

/**
 * Stub: real impl arrives in task #16. Renderer subscribes via the preload;
 * once TerminalStatusMonitor is wired it will call broadcastTerminalStatus.
 */
export function broadcastTerminalStatus(updates: TerminalStatusUpdate[]): void {
  if (updates.length === 0) return;
  for (const wc of webContents.getAllWebContents()) {
    if (wc.isDestroyed()) continue;
    wc.send(Channels.TerminalStatusUpdate, updates);
  }
}
