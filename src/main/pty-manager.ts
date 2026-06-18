import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { run } from './util/exec';

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

/**
 * Resolves a shell's current cwd. Defaults to `lsof -p <pid> -d cwd`.
 * Injectable so tests can return a deterministic value without touching `lsof`.
 * Should resolve to `null` on any failure rather than throwing.
 */
export type CwdProbe = (pid: number) => Promise<string | null>;

interface PtyEntry {
  proc: IPtyLike;
  shellPid: number;
  pendingChunks: string[];
  flushScheduled: boolean;
  dataSub: { dispose(): void };
  exitSub: { dispose(): void };
  /** Last-known cwd. Seeded with opts.cwd at spawn; updated by OSC 7 + lsof. */
  cwd: string;
  /**
   * Tail of recent output retained so an OSC 7 sequence that straddles two
   * chunk boundaries still parses on the next chunk. Capped at OSC_TAIL_MAX.
   */
  oscScanTail: string;
  /** epoch ms of the most recent OSC 7 observation (0 if never). */
  lastOscAt: number;
  cwdPollTimer: NodeJS.Timeout | null;
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

export interface PtyCwdChangedEvent {
  id: string;
  cwd: string;
}

/**
 * Owns node-pty processes. Coalesces high-frequency data chunks into one event
 * per microtask tick so the IPC layer relays a manageable number of messages
 * to the renderer (otherwise every ~64-byte read becomes its own ipcRenderer
 * event during something like `npm install`).
 *
 * Per-PTY cwd tracking has two sources:
 *   1. **OSC 7** — most modern shells emit `ESC ] 7 ; file://host/path BEL` on
 *      each prompt. Apple's stock zsh/bash do; user-customised dotfiles often
 *      drop it. Parsed inline from data chunks; sub-prompt latency.
 *   2. **lsof poll** — `lsof -p <shellPid> -d cwd -Fn` every `cwdPollMs`. Acts
 *      as a floor for shells without OSC 7. Skipped when OSC 7 was observed
 *      within the last 2 intervals (so OSC-7-enabled shells pay zero lsof
 *      cost in steady state).
 *
 * Emits:
 *   - 'spawned'      { id, shellPid }
 *   - 'data'         { id, chunk }
 *   - 'exit'         { id, code, signal }
 *   - 'cwd-changed'  { id, cwd }   — fires once on spawn with opts.cwd, then
 *                                    only on transitions
 */
export class PtyManager extends EventEmitter {
  private readonly ptys = new Map<string, PtyEntry>();

  constructor(
    private readonly spawnFn: SpawnFn,
    private readonly cwdProbe: CwdProbe = defaultCwdProbe,
    private readonly cwdPollMs: number = 5000,
  ) {
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
      cwd: opts.cwd,
      oscScanTail: '',
      lastOscAt: 0,
      cwdPollTimer: null,
    };

    this.ptys.set(id, entry);
    this.emit('spawned', { id, shellPid: proc.pid } satisfies PtySpawnedEvent);
    // Surface the initial cwd so subscribers don't need to special-case spawn.
    this.emit('cwd-changed', { id, cwd: opts.cwd } satisfies PtyCwdChangedEvent);

    if (this.cwdPollMs > 0) {
      entry.cwdPollTimer = setInterval(() => void this.pollCwd(id), this.cwdPollMs);
    }

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

  /** Last-known cwd of `id`, or undefined if no such PTY. */
  cwdOf(id: string): string | undefined {
    return this.ptys.get(id)?.cwd;
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private queueChunk(id: string, chunk: string): void {
    const entry = this.ptys.get(id);
    if (!entry) return;
    this.scanForOsc7(id, entry, chunk);
    entry.pendingChunks.push(chunk);
    if (!entry.flushScheduled) {
      entry.flushScheduled = true;
      setImmediate(() => this.flushNow(id));
    }
  }

  /**
   * Inspect a chunk (concatenated with the prior scan tail) for OSC 7 cwd
   * notifications. Updates `entry.cwd` and emits `cwd-changed` on transitions.
   * Retains a bounded suffix as the next scan tail so a sequence split across
   * chunks still resolves on the following call.
   */
  private scanForOsc7(id: string, entry: PtyEntry, chunk: string): void {
    const buf = entry.oscScanTail + chunk;
    let lastEnd = 0;
    let foundCwd: string | null = null;

    OSC7_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = OSC7_RE.exec(buf)) !== null) {
      const decoded = decodeOsc7Body(match[1]!);
      if (decoded) foundCwd = decoded;
      lastEnd = OSC7_RE.lastIndex;
    }

    // Tail = anything after the last fully-matched sequence that still might
    // contain the start of a new (partial) one. Capped so a malformed stream
    // missing its terminator doesn't grow the buffer without bound.
    const after = buf.slice(lastEnd);
    const partialStart = after.lastIndexOf(OSC7_PREFIX);
    entry.oscScanTail = partialStart === -1
      ? ''
      : after.slice(partialStart, partialStart + OSC_TAIL_MAX);

    if (foundCwd !== null) {
      entry.lastOscAt = Date.now();
      if (foundCwd !== entry.cwd) {
        entry.cwd = foundCwd;
        this.emit('cwd-changed', { id, cwd: foundCwd } satisfies PtyCwdChangedEvent);
      }
    }
  }

  /**
   * Resolve the shell's cwd via the injected probe. Skipped if OSC 7 was seen
   * recently — that signal is faster and free.
   */
  private async pollCwd(id: string): Promise<void> {
    const entry = this.ptys.get(id);
    if (!entry) return;
    if (Date.now() - entry.lastOscAt < this.cwdPollMs * 2) return;

    const cwd = await this.cwdProbe(entry.shellPid);
    // Re-fetch: the entry may have been disposed during the await.
    const live = this.ptys.get(id);
    if (!live) return;
    if (cwd && cwd !== live.cwd) {
      live.cwd = cwd;
      this.emit('cwd-changed', { id, cwd } satisfies PtyCwdChangedEvent);
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
    if (entry.cwdPollTimer) {
      clearInterval(entry.cwdPollTimer);
      entry.cwdPollTimer = null;
    }
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

// ── OSC 7 parsing ───────────────────────────────────────────────────────────

const OSC7_PREFIX = '\x1b]7;';
/** Body must not contain BEL (terminator) or ESC (start of ST terminator). */
// eslint-disable-next-line no-control-regex
const OSC7_RE = /\x1b\]7;([^\x07\x1b]*)(?:\x07|\x1b\\)/g;
/**
 * Cap on the bytes carried over between chunks while waiting for an OSC 7
 * terminator. 4 KB comfortably exceeds any plausible cwd path even with
 * percent-encoding; anything longer is malformed and gets truncated.
 */
const OSC_TAIL_MAX = 4096;

/**
 * Decode an OSC 7 body of the form `file://[host]/percent-encoded-path`.
 * Returns the absolute path or null if the body isn't a parseable file URL.
 */
function decodeOsc7Body(body: string): string | null {
  if (!body.startsWith('file://')) return null;
  const rest = body.slice('file://'.length);
  const slash = rest.indexOf('/');
  if (slash === -1) return null;
  const encoded = rest.slice(slash); // keep the leading slash
  try {
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
}

// ── default cwd probe ───────────────────────────────────────────────────────

/**
 * `lsof -p <pid> -d cwd -Fn` prints three lines:
 *
 *   p<pid>
 *   fcwd
 *   n/path/to/cwd
 *
 * We only need the line beginning with `n`. Returns null on any failure so
 * callers can keep their last-known cwd.
 */
export const defaultCwdProbe: CwdProbe = async (pid) => {
  try {
    const { stdout } = await run(
      'lsof',
      ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'],
      { timeoutMs: 2000, throwOnError: false },
    );
    for (const line of stdout.split('\n')) {
      if (line.startsWith('n')) return line.slice(1);
    }
    return null;
  } catch {
    return null;
  }
};

// ── default node-pty bridge ─────────────────────────────────────────────────

/**
 * Dir prepended to every spawned shell's PATH so the `treeline` CLI is reachable
 * from agents running inside the app — even in a downloaded build with no source
 * checkout. Set once at startup via `setManagedBinDir` (see `cli-install.ts`);
 * null in tests and until startup wires it.
 */
let managedBinDir: string | null = null;

/** Register the bin dir prepended to spawned-terminal PATHs. Idempotent. */
export function setManagedBinDir(dir: string | null): void {
  managedBinDir = dir;
}

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
    env: sanitizeEnv(process.env, managedBinDir),
  }) as IPtyLike;
}

export function sanitizeEnv(
  env: NodeJS.ProcessEnv,
  binDir: string | null = null,
): { [k: string]: string } {
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
  // Prepend the managed bin dir (holding the `treeline` shim) unless it's
  // already on PATH, so the CLI resolves first without duplicating entries.
  if (binDir) {
    const parts = (out['PATH'] ?? '').split(':');
    if (!parts.includes(binDir)) {
      out['PATH'] = out['PATH'] ? `${binDir}:${out['PATH']}` : binDir;
    }
  }
  return out;
}
