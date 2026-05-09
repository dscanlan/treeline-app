import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';

// Avoid binding node-pty's IPty type at module-evaluation time (the binding may
// not be available in vitest's Node runtime where the .node addon was built
// against Electron's ABI). Tests inject a fake; production calls defaultSpawn.
export interface IPtyLike {
  pid: number;
  onData(cb: (chunk: string) => void): { dispose(): void };
  onExit(cb: (e: { exitCode: number; signal?: number | null }) => void): { dispose(): void };
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
}

export interface SpawnOpts {
  cwd: string;
  cols: number;
  rows: number;
  /** Defaults to process.env.SHELL ?? '/bin/zsh'. */
  shell?: string;
}

export type SpawnFn = (opts: SpawnOpts) => IPtyLike;

interface PtyEntry {
  proc: IPtyLike;
  shellPid: number;
  pendingChunks: string[];
  flushScheduled: boolean;
  dataSub: { dispose(): void };
  exitSub: { dispose(): void };
}

export interface PtyDataEvent {
  id: string;
  chunk: string;
}

export interface PtyExitEvent {
  id: string;
  code: number;
  signal: number | null;
}

export interface PtySpawnedEvent {
  id: string;
  shellPid: number;
}

/**
 * Owns node-pty processes. Coalesces high-frequency data chunks into one event
 * per microtask tick so the IPC layer relays a manageable number of messages
 * to the renderer (otherwise every ~64-byte read becomes its own ipcRenderer
 * event during something like `npm install`).
 *
 * Emits:
 *   - 'spawned'  { id, shellPid }
 *   - 'data'     { id, chunk }
 *   - 'exit'     { id, code, signal }
 */
export class PtyManager extends EventEmitter {
  private readonly ptys = new Map<string, PtyEntry>();

  constructor(private readonly spawnFn: SpawnFn) {
    super();
  }

  spawn(opts: SpawnOpts): { id: string; shellPid: number } {
    const id = randomUUID();
    const proc = this.spawnFn(opts);

    const entry: PtyEntry = {
      proc,
      shellPid: proc.pid,
      pendingChunks: [],
      flushScheduled: false,
      dataSub: proc.onData((chunk) => this.queueChunk(id, chunk)),
      exitSub: proc.onExit(({ exitCode, signal }) => {
        this.flushNow(id);
        this.emit('exit', {
          id,
          code: exitCode,
          signal: signal ?? null,
        } satisfies PtyExitEvent);
        this.disposeEntry(id);
      }),
    };

    this.ptys.set(id, entry);
    this.emit('spawned', { id, shellPid: proc.pid } satisfies PtySpawnedEvent);
    return { id, shellPid: proc.pid };
  }

  write(id: string, data: string): void {
    this.ptys.get(id)?.proc.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    const entry = this.ptys.get(id);
    if (!entry) return;
    // node-pty throws if cols/rows are 0; clamp for safety.
    entry.proc.resize(Math.max(1, cols | 0), Math.max(1, rows | 0));
  }

  /**
   * Politely SIGHUP, then SIGKILL after `graceMs` if the process is still
   * registered. Resolves once exit has fired (or grace elapsed).
   */
  async kill(id: string, graceMs = 200): Promise<void> {
    const entry = this.ptys.get(id);
    if (!entry) return;

    return new Promise<void>((resolve) => {
      const onExit = (e: PtyExitEvent) => {
        if (e.id !== id) return;
        this.off('exit', onExit);
        clearTimeout(killTimer);
        resolve();
      };
      this.on('exit', onExit);

      try {
        entry.proc.kill('SIGHUP');
      } catch {
        // Already dead — exit event will fire shortly.
      }
      const killTimer = setTimeout(() => {
        if (this.ptys.has(id)) {
          try {
            entry.proc.kill('SIGKILL');
          } catch {
            /* ignore */
          }
        }
      }, graceMs);
    });
  }

  /** Kill every PTY. Used during app quit. */
  async killAll(graceMs = 200): Promise<void> {
    await Promise.all([...this.ptys.keys()].map((id) => this.kill(id, graceMs)));
  }

  /** True if a PTY with this id is still registered. */
  has(id: string): boolean {
    return this.ptys.has(id);
  }

  /** PIDs of all live shells, used by TerminalStatusMonitor. */
  shellPids(): { id: string; shellPid: number }[] {
    return [...this.ptys.entries()].map(([id, e]) => ({ id, shellPid: e.shellPid }));
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private queueChunk(id: string, chunk: string): void {
    const entry = this.ptys.get(id);
    if (!entry) return;
    entry.pendingChunks.push(chunk);
    if (!entry.flushScheduled) {
      entry.flushScheduled = true;
      setImmediate(() => this.flushNow(id));
    }
  }

  private flushNow(id: string): void {
    const entry = this.ptys.get(id);
    if (!entry) return;
    if (entry.pendingChunks.length === 0) {
      entry.flushScheduled = false;
      return;
    }
    const chunk = entry.pendingChunks.join('');
    entry.pendingChunks.length = 0;
    entry.flushScheduled = false;
    this.emit('data', { id, chunk } satisfies PtyDataEvent);
  }

  private disposeEntry(id: string): void {
    const entry = this.ptys.get(id);
    if (!entry) return;
    try {
      entry.dataSub.dispose();
    } catch {
      /* ignore */
    }
    try {
      entry.exitSub.dispose();
    } catch {
      /* ignore */
    }
    this.ptys.delete(id);
  }
}

// ── default node-pty bridge ─────────────────────────────────────────────────

/**
 * Default spawn function — lazy-requires node-pty so a vitest run that injects
 * a fake never tries to load the .node addon.
 */
export function defaultSpawn(opts: SpawnOpts): IPtyLike {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pty = require('node-pty') as typeof import('node-pty');
  const shell = opts.shell ?? process.env['SHELL'] ?? '/bin/zsh';
  return pty.spawn(shell, ['-l'], {
    name: 'xterm-256color',
    cols: Math.max(1, opts.cols | 0),
    rows: Math.max(1, opts.rows | 0),
    cwd: opts.cwd,
    env: sanitizeEnv(process.env),
  }) as IPtyLike;
}

function sanitizeEnv(env: NodeJS.ProcessEnv): { [k: string]: string } {
  const out: { [k: string]: string } = {};
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) continue;
    if (k === 'ELECTRON_RUN_AS_NODE') continue;
    if (k === 'ELECTRON_NO_ATTACH_CONSOLE') continue;
    if (k === 'NODE_OPTIONS') continue;
    out[k] = v;
  }
  out['TERM'] = 'xterm-256color';
  out['COLORTERM'] = 'truecolor';
  return out;
}
