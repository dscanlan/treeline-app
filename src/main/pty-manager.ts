import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { AgentKind } from '@shared/agents';
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
  /**
   * The PTY id, exported into the shell as `TREELINE_PANE_ID`. Child processes
   * (an agent, and the Claude Code hooks it spawns) inherit it, so a hook can
   * report *exactly which pane* it ran in instead of just its cwd — two tabs in
   * the same directory are otherwise indistinguishable by cwd alone.
   */
  paneId?: string;
  /**
   * Sidebar label ("Scratch N") when this PTY backs a scratch terminal. The
   * renderer's scratch slice is memory-only and is wiped on a reload, but the
   * PTY survives here in main — echoing the label back through {@link
   * PtyManager.list} lets the reload re-attach recover the scratch's sidebar row
   * (and its exit cleanup) instead of degrading it to a plain tab. Undefined for
   * ordinary terminals.
   */
  scratchLabel?: string;
}

export type SpawnFn = (opts: SpawnOpts) => IPtyLike;

/**
 * Resolves a shell's current cwd. Defaults to `lsof -p <pid> -d cwd`.
 * Injectable so tests can return a deterministic value without touching `lsof`.
 * Should resolve to `null` on any failure rather than throwing.
 */
export type CwdProbe = (pid: number) => Promise<string | null>;

/**
 * Resolves a process and all its descendants (root included). Used to freeze a
 * whole pane — shell + agent + the agent's children — in one go. Defaults to a
 * `ps`-based walk; injectable so tests don't touch the real process table.
 */
export type SubtreeProbe = (rootPid: number) => Promise<number[]>;

/** Send a signal to a pid. Injectable so tests can record calls. */
export type SignalFn = (pid: number, signal: NodeJS.Signals) => void;

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
   * Tail of recent output retained so an OSC sequence (cwd OSC 7 or a
   * notification OSC 9/99/777) that straddles two chunk boundaries still parses
   * on the next chunk. Capped at OSC_TAIL_MAX.
   */
  oscScanTail: string;
  /** epoch ms of the most recent OSC 7 observation (0 if never). */
  lastOscAt: number;
  cwdPollTimer: NodeJS.Timeout | null;
  /** True while the pane's process subtree is SIGSTOP-frozen (see pause()). */
  paused: boolean;
  /** Scratch-terminal sidebar label, if this PTY backs one (see SpawnOpts). */
  scratchLabel?: string;
  /**
   * The agent session last reported for this pane (by the agent's
   * session-start hook, via the CLI socket), tagged with the agent kind it was
   * reported under. Identifies the pane's ACTUAL conversation for save-time
   * pinning — unlike the per-cwd newest-transcript heuristic, it can tell two
   * panes in the same directory apart. Overwritten on every report (new
   * session / --resume / /clear / compaction bridge all re-fire the hook);
   * dies with the entry. A stale value is harmless: the renderer only pins it
   * onto panes whose current foreground agent matches the recorded kind.
   */
  agentSession?: { kind: AgentKind; sessionId: string };
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

export interface PtyNotificationEvent {
  id: string;
  /** Human-readable notification text the agent raised. */
  text: string;
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
 * The same inline OSC scanner also watches for desktop-notification escapes
 * (OSC 9 / 99 / 777) that agents emit when they need the human's attention,
 * and re-emits them as 'notification' events — the explicit "needs attention"
 * signal the renderer turns into pane rings + sidebar unread badges.
 *
 * Emits:
 *   - 'spawned'      { id, shellPid }
 *   - 'data'         { id, chunk }
 *   - 'exit'         { id, code, signal }
 *   - 'cwd-changed'  { id, cwd }   — fires once on spawn with opts.cwd, then
 *                                    only on transitions
 *   - 'notification' { id, text }  — an OSC 9/99/777 desktop notification
 */
export class PtyManager extends EventEmitter {
  private readonly ptys = new Map<string, PtyEntry>();

  constructor(
    private readonly spawnFn: SpawnFn,
    private readonly cwdProbe: CwdProbe = defaultCwdProbe,
    private readonly cwdPollMs: number = 5000,
    private readonly subtreeProbe: SubtreeProbe = defaultSubtreeProbe,
    private readonly signalFn: SignalFn = defaultSignal,
  ) {
    super();
  }

  spawn(opts: SpawnOpts): { id: string; shellPid: number } {
    const id = randomUUID();
    const proc = this.spawnFn({ ...opts, paneId: id });

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
      paused: false,
      scratchLabel: opts.scratchLabel,
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

  /**
   * Inject input into one PTY, like `tmux send-keys -t <pane>`. Returns false
   * when the pane is no longer live so socket callers can report a useful
   * failure instead of silently sending input nowhere.
   */
  write(id: string, data: string): boolean {
    const entry = this.ptys.get(id);
    if (!entry) return false;
    entry.proc.write(data);
    return true;
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

  /**
   * Freeze the pane: SIGSTOP the shell **and every descendant** (the agent and
   * its children), so a running agent genuinely stops consuming CPU rather than
   * just losing focus. Used by the "resume this session in a worktree" handoff
   * to park the origin session so two copies of the same conversation can't act
   * at once. Signals leaves-first so a parent can't reap a child mid-stop.
   * Best-effort per pid (a races-away child is ignored); returns false if the
   * pty is gone. Idempotent.
   */
  async pause(id: string): Promise<boolean> {
    const entry = this.ptys.get(id);
    if (!entry) return false;
    const pids = await this.subtreeProbe(entry.shellPid);
    for (const pid of [...pids].reverse()) this.signalFn(pid, 'SIGSTOP');
    entry.paused = true;
    return true;
  }

  /**
   * Thaw a {@link pause}d pane: SIGCONT the subtree root-first (so the shell is
   * runnable before its children wake). Best-effort; returns false if the pty is
   * gone. Idempotent.
   */
  async resume(id: string): Promise<boolean> {
    const entry = this.ptys.get(id);
    if (!entry) return false;
    const pids = await this.subtreeProbe(entry.shellPid);
    for (const pid of pids) this.signalFn(pid, 'SIGCONT');
    entry.paused = false;
    return true;
  }

  /** True if `id` is currently SIGSTOP-frozen. */
  isPaused(id: string): boolean {
    return this.ptys.get(id)?.paused ?? false;
  }

  /** True if a PTY with this id is still registered. */
  has(id: string): boolean {
    return this.ptys.has(id);
  }

  /** PIDs of all live shells, used by TerminalStatusMonitor. */
  shellPids(): { id: string; shellPid: number }[] {
    return [...this.ptys.entries()].map(([id, e]) => ({ id, shellPid: e.shellPid }));
  }

  /**
   * Snapshot of every live PTY, for the renderer to re-attach after a reload.
   * The renderer's tab state is in-memory and wiped on reload, but these PTYs
   * (and the agents inside them) keep running here — without re-attach they'd
   * be orphaned, killable only by quitting the app. `scratchLabel` is echoed
   * back for scratch PTYs so re-attach can rebuild their sidebar row.
   */
  list(): { id: string; cwd: string; scratchLabel?: string }[] {
    return [...this.ptys.entries()].map(([id, e]) => ({
      id,
      cwd: e.cwd,
      ...(e.scratchLabel !== undefined ? { scratchLabel: e.scratchLabel } : {}),
    }));
  }

  /** Last-known cwd of `id`, or undefined if no such PTY. */
  cwdOf(id: string): string | undefined {
    return this.ptys.get(id)?.cwd;
  }

  /**
   * Record the session id reported for pane `id` (an agent's session-start
   * hook → CLI socket), tagged with the agent kind that reported it. Returns
   * false when no such PTY exists — unknown pane ids are dropped rather than
   * accumulated.
   */
  setAgentSession(id: string, kind: AgentKind, sessionId: string): boolean {
    const entry = this.ptys.get(id);
    if (!entry) return false;
    entry.agentSession = { kind, sessionId };
    return true;
  }

  /** Every pane's last-reported agent session (kind-tagged), for save-time pinning. */
  agentSessionIds(): Record<string, { kind: AgentKind; sessionId: string }> {
    const out: Record<string, { kind: AgentKind; sessionId: string }> = {};
    for (const [id, e] of this.ptys) {
      if (e.agentSession !== undefined) out[id] = { ...e.agentSession };
    }
    return out;
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private queueChunk(id: string, chunk: string): void {
    const entry = this.ptys.get(id);
    if (!entry) return;
    this.scanForOsc(id, entry, chunk);
    entry.pendingChunks.push(chunk);
    if (!entry.flushScheduled) {
      entry.flushScheduled = true;
      setImmediate(() => this.flushNow(id));
    }
  }

  /**
   * Inspect a chunk (concatenated with the prior scan tail) for OSC sequences:
   *   - OSC 7 cwd notifications → update `entry.cwd`, emit 'cwd-changed'.
   *   - OSC 9/99/777 desktop notifications → emit 'notification' (once per
   *     sequence, in stream order).
   * Retains a bounded suffix as the next scan tail so a sequence split across
   * chunks still resolves on the following call.
   */
  private scanForOsc(id: string, entry: PtyEntry, chunk: string): void {
    const buf = entry.oscScanTail + chunk;
    let lastEnd = 0;
    let foundCwd: string | null = null;
    const notifications: string[] = [];

    OSC_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = OSC_RE.exec(buf)) !== null) {
      const code = match[1]!;
      const body = match[2]!;
      if (code === '7') {
        const decoded = decodeOsc7Body(body);
        if (decoded) foundCwd = decoded;
      } else {
        const text = parseOscNotification(code, body);
        if (text) notifications.push(text);
      }
      lastEnd = OSC_RE.lastIndex;
    }

    // Tail = anything after the last fully-matched sequence that still might
    // contain the start of a new (partial) one. Capped so a malformed stream
    // missing its terminator doesn't grow the buffer without bound.
    const after = buf.slice(lastEnd);
    const partialStart = after.lastIndexOf(OSC_PREFIX);
    entry.oscScanTail = partialStart === -1
      ? ''
      : after.slice(partialStart, partialStart + OSC_TAIL_MAX);

    if (foundCwd !== null) {
      // Only a genuine cwd observation refreshes the lsof-poll backoff clock —
      // a notification says nothing about where the shell is.
      entry.lastOscAt = Date.now();
      if (foundCwd !== entry.cwd) {
        entry.cwd = foundCwd;
        this.emit('cwd-changed', { id, cwd: foundCwd } satisfies PtyCwdChangedEvent);
      }
    }

    for (const text of notifications) {
      this.emit('notification', { id, text } satisfies PtyNotificationEvent);
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

// ── OSC parsing ─────────────────────────────────────────────────────────────

/** Start of any OSC sequence; used to find a partial straddling a chunk edge. */
const OSC_PREFIX = '\x1b]';
/**
 * Match any `ESC ] <code> ; <body> (BEL | ST)` OSC sequence. The body must not
 * contain BEL (terminator) or ESC (start of the ST terminator). We dispatch on
 * `<code>`: 7 is cwd, 9/99/777 are notifications, everything else is ignored
 * (and consumed, so window-title/colour OSCs don't pollute the carry-over tail).
 */
// eslint-disable-next-line no-control-regex
const OSC_RE = /\x1b\]([0-9]{1,4});([^\x07\x1b]*)(?:\x07|\x1b\\)/g;
/**
 * Cap on the bytes carried over between chunks while waiting for an OSC
 * terminator. 4 KB comfortably exceeds any plausible cwd path even with
 * percent-encoding; anything longer is malformed and gets truncated.
 */
const OSC_TAIL_MAX = 4096;

/**
 * Extract human-readable text from a desktop-notification OSC body. Supports
 * the three escape codes cmux-style agents emit:
 *
 *   - OSC 9   `ESC ] 9 ; <text> BEL`                       — iTerm2 growl.
 *   - OSC 777 `ESC ] 777 ; notify ; <title> ; <body> BEL`  — urxvt/notify-send.
 *   - OSC 99  `ESC ] 99 ; <metadata> ; <payload> ST`       — kitty desktop-notify.
 *
 * Returns the text to surface, or null when the body isn't a notification we
 * recognise (ConEmu's OSC 9 progress subcommands, empty bodies, etc.).
 */
function parseOscNotification(code: string, body: string): string | null {
  switch (code) {
    case '9': {
      // ConEmu overloads OSC 9 for progress/other subcommands of the form
      // `9;<digit>;…`; those aren't notifications. iTerm2's growl form is free
      // text right after the code.
      if (body.length === 0 || /^\d;/.test(body)) return null;
      return body;
    }
    case '777': {
      // `notify;<title>;<body>` (body optional). Other 777 subcommands (urxvt
      // font/colour) aren't notifications.
      const parts = body.split(';');
      if (parts[0] !== 'notify') return null;
      const [, title, ...rest] = parts;
      const text = [title, rest.join(';')].filter((p) => p && p.length > 0).join(': ');
      return text.length > 0 ? text : null;
    }
    case '99': {
      // kitty: `<metadata>;<payload>`. metadata is `:`/`,`-separated k=v pairs;
      // we only need the payload (the notification text). `e=1` marks it base64.
      const semi = body.indexOf(';');
      if (semi === -1) return null; // metadata-only chunk (e.g. a close marker)
      const meta = body.slice(0, semi);
      let payload = body.slice(semi + 1);
      if (payload.length === 0) return null;
      if (/(^|[,:])e=1([,:]|$)/.test(meta)) {
        try {
          payload = Buffer.from(payload, 'base64').toString('utf8');
        } catch {
          /* leave as-is */
        }
      }
      return payload.length > 0 ? payload : null;
    }
    default:
      return null;
  }
}

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

// ── default subtree probe + signaller (pause/resume) ────────────────────────

/**
 * Resolve `rootPid` and all its transitive descendants via a single
 * `ps -axo pid=,ppid=` snapshot (one cheap call, no per-pid lsof). Returned
 * breadth-first with the root first, so callers can stop leaves-first by
 * reversing and continue root-first as-is. On any failure returns just the
 * root, so a pause still freezes the shell even if the walk fails.
 */
export const defaultSubtreeProbe: SubtreeProbe = async (rootPid) => {
  try {
    const { stdout } = await run('ps', ['-axo', 'pid=,ppid='], {
      timeoutMs: 4000,
      throwOnError: false,
    });
    const children = new Map<number, number[]>();
    for (const line of stdout.split('\n')) {
      const m = line.trim().match(/^(\d+)\s+(\d+)$/);
      if (!m) continue;
      const pid = Number(m[1]);
      const ppid = Number(m[2]);
      const siblings = children.get(ppid);
      if (siblings) siblings.push(pid);
      else children.set(ppid, [pid]);
    }
    const out: number[] = [];
    const queue = [rootPid];
    const seen = new Set<number>();
    while (queue.length > 0) {
      const pid = queue.shift()!;
      if (seen.has(pid)) continue; // guard against any cyclic ppid weirdness
      seen.add(pid);
      out.push(pid);
      for (const child of children.get(pid) ?? []) queue.push(child);
    }
    return out;
  } catch {
    return [rootPid];
  }
};

/** Default signaller — `process.kill`, swallowing ESRCH/EPERM for dead pids. */
export const defaultSignal: SignalFn = (pid, signal) => {
  try {
    process.kill(pid, signal);
  } catch {
    /* already gone or not permitted — best-effort */
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
    env: sanitizeEnv(process.env, managedBinDir, opts.paneId),
  }) as IPtyLike;
}

export function sanitizeEnv(
  env: NodeJS.ProcessEnv,
  binDir: string | null = null,
  paneId: string | null = null,
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
  // Tag the shell with its pane id so the Claude Code notify hook (which has no
  // tty and only knows its cwd) can report the exact pane it ran in. Inherited
  // by every child process of the shell.
  if (paneId) out['TREELINE_PANE_ID'] = paneId;
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
