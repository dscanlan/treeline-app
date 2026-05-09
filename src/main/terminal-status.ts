import { EventEmitter } from 'node:events';
import { basename } from 'node:path';
import type { TabStatus, TerminalStatusUpdate } from '@shared/types';
import { run } from './util/exec';

interface Registered {
  shellPid: number;
  lastStatus: TabStatus;
  lastForegroundCmd: string | null;
}

/** Provider for the per-tick process scan. Tests inject a fake. */
export type PsScanFn = () => Promise<ProcEntry[]>;

export interface ProcEntry {
  pid: number;
  ppid: number;
  comm: string; // basename of the executable
}

/**
 * Polls the process table once a second to determine, per registered PTY,
 * whether the shell is `running` (has a foreground child), `idle` (no child),
 * or `exited` (shell pid is gone). Emits 'updates' with deltas only.
 *
 * Detection is independent from the AI-CLI ProcessMonitor — this watches
 * *every* PTY's foreground state, AI tool or not.
 */
export class TerminalStatusMonitor extends EventEmitter {
  private readonly entries = new Map<string, Registered>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly tickMs: number = 1000,
    private readonly scan: PsScanFn = defaultPsScan,
  ) {
    super();
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.tickMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  register(ptyId: string, shellPid: number): void {
    this.entries.set(ptyId, {
      shellPid,
      lastStatus: 'idle',
      lastForegroundCmd: null,
    });
  }

  unregister(ptyId: string): void {
    this.entries.delete(ptyId);
  }

  /** Public so tests can step a tick deterministically. */
  async tick(): Promise<void> {
    if (this.entries.size === 0) return;

    let table: ProcEntry[];
    try {
      table = await this.scan();
    } catch {
      return; // transient ps failure; try again next tick
    }

    // Bucket children by ppid for O(1) lookup per PTY.
    const childrenByPpid = new Map<number, ProcEntry[]>();
    for (const p of table) {
      const arr = childrenByPpid.get(p.ppid);
      if (arr) arr.push(p);
      else childrenByPpid.set(p.ppid, [p]);
    }

    const updates: TerminalStatusUpdate[] = [];
    for (const [ptyId, entry] of this.entries) {
      const next = computeStatus(entry.shellPid, childrenByPpid);
      if (
        next.status !== entry.lastStatus ||
        next.foregroundCmd !== entry.lastForegroundCmd
      ) {
        entry.lastStatus = next.status;
        entry.lastForegroundCmd = next.foregroundCmd;
        updates.push({
          ptyId,
          status: next.status,
          foregroundCmd: next.foregroundCmd,
        });
      }
    }

    if (updates.length > 0) this.emit('updates', updates);
  }
}

interface StatusResult {
  status: TabStatus;
  foregroundCmd: string | null;
}

export function computeStatus(
  shellPid: number,
  childrenByPpid: Map<number, ProcEntry[]>,
): StatusResult {
  // Cheap liveness probe: kill(pid, 0) throws ESRCH if the pid is gone. We
  // can't import process here directly because we want to keep this pure for
  // tests, so accept that the shell is "exited" only if it isn't in the
  // process table at all (no row with pid === shellPid AND no children).
  const hasShellRow = anyMatchesPid(childrenByPpid, shellPid);
  const children = childrenByPpid.get(shellPid) ?? [];

  if (!hasShellRow && children.length === 0) {
    return { status: 'exited', foregroundCmd: null };
  }
  if (children.length === 0) {
    return { status: 'idle', foregroundCmd: null };
  }
  // Pick the highest PID — that's the most recent fork, which is almost
  // always the foreground process under the shell.
  const newest = children.reduce((a, b) => (a.pid > b.pid ? a : b));
  return { status: 'running', foregroundCmd: newest.comm || null };
}

function anyMatchesPid(map: Map<number, ProcEntry[]>, pid: number): boolean {
  for (const arr of map.values()) {
    for (const p of arr) if (p.pid === pid) return true;
  }
  return false;
}

// ── default `ps` scanner ────────────────────────────────────────────────────

export async function defaultPsScan(): Promise<ProcEntry[]> {
  // `-A` is BSD-style for "all processes"; `comm=` strips the header. macOS's
  // /bin/ps supports this exact form.
  const { stdout } = await run('ps', ['-A', '-o', 'pid=,ppid=,comm='], {
    timeoutMs: 4_000,
    throwOnError: false,
  });
  return parsePsOutput(stdout);
}

export function parsePsOutput(output: string): ProcEntry[] {
  const out: ProcEntry[] = [];
  for (const raw of output.split('\n')) {
    const line = raw.trimStart();
    if (line.length === 0) continue;
    // pid ppid comm... — comm may contain spaces, so split into 3.
    const m = line.match(/^(\d+)\s+(\d+)\s+(.+)$/);
    if (!m || !m[1] || !m[2] || !m[3]) continue;
    out.push({
      pid: Number(m[1]),
      ppid: Number(m[2]),
      comm: basename(m[3].trim()),
    });
  }
  return out;
}
