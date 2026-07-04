// Ported from /Users/dominicscanlan/code/treeline/src/dashboard.rs:103-148,
// 295-307, 389-411. Tracks `claude` / `opencode` / `aider` processes across
// the whole machine, attributes them to known worktrees via longest-prefix
// match, and flags them as idle when CPU time hasn't moved for ≥10s.

import { EventEmitter } from 'node:events';
import { basename } from 'node:path';
import { KIND_BY_BASENAME } from '@shared/agents';
import type { DetectedProcess, ProcessKind } from '@shared/types';
import { run } from './util/exec';

const IDLE_THRESHOLD_MS = 10_000;

export interface RawProcess {
  pid: number;
  kind: ProcessKind;
  cwd: string;
  cputime: number; // seconds
}

interface CpuSample {
  cputime: number;
  /** epoch ms of the last detected change. */
  lastChange: number;
}

export type ScanFn = () => Promise<RawProcess[]>;

/** A single listening TCP socket: the owning pid and its local port. */
export interface Listener {
  pid: number;
  port: number;
}

/** A {@link Listener} once its owning process's cwd has been resolved. */
export interface ListenerWithCwd extends Listener {
  cwd: string | null;
}

export type PortScanFn = () => Promise<ListenerWithCwd[]>;

/**
 * Polls the process table once every 2s. Emits 'snapshot' with the deduped
 * list of detected processes plus a `processesByWorktreePath` index that the
 * renderer can consume directly without doing its own prefix matching.
 *
 * Emits:
 *   - 'snapshot' { procs, byWorktreePath }
 */
export class ProcessMonitor extends EventEmitter {
  private readonly cpuHistory = new Map<number, CpuSample>();
  private worktreePaths: string[] = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly tickMs: number = 2000,
    private readonly scan: ScanFn = defaultScan,
    private readonly portScan: PortScanFn = defaultPortScan,
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

  setWorktreePaths(paths: string[]): void {
    // Sorting longest-first lets `longestPrefixMatch` short-circuit on the
    // first hit. We also dedupe: a stale path could otherwise stick around.
    this.worktreePaths = [...new Set(paths)].sort((a, b) => b.length - a.length);
  }

  /** Public for tests. */
  async tick(): Promise<void> {
    // Run the ps/lsof process scan and the listening-port scan concurrently and
    // independently: lsof can be slow or fail, and a failure in either pass must
    // not take down the other. `allSettled` never rejects.
    const [procResult, portResult] = await Promise.allSettled([
      this.scan(),
      this.portScan(),
    ]);

    if (procResult.status !== 'fulfilled') return;
    const raw = procResult.value;

    const listeners = portResult.status === 'fulfilled' ? portResult.value : [];

    const now = Date.now();
    const nextHistory = new Map<number, CpuSample>();
    const detected: DetectedProcess[] = [];

    for (const p of raw) {
      const prev = this.cpuHistory.get(p.pid);
      let lastChange: number;
      let idle = false;
      if (prev) {
        if (Math.abs(p.cputime - prev.cputime) > 0.01) {
          lastChange = now;
          idle = false;
        } else {
          lastChange = prev.lastChange;
          idle = now - prev.lastChange >= IDLE_THRESHOLD_MS;
        }
      } else {
        lastChange = now;
      }
      nextHistory.set(p.pid, { cputime: p.cputime, lastChange });
      detected.push({ pid: p.pid, kind: p.kind, cwd: p.cwd, idle });
    }

    // Replace history: any pids that disappeared between ticks are dropped.
    this.cpuHistory.clear();
    for (const [k, v] of nextHistory) this.cpuHistory.set(k, v);

    const byWorktreePath = indexByWorktreePath(detected, this.worktreePaths);
    const portsByWorktreePath = indexPortsByWorktreePath(listeners, this.worktreePaths);
    this.emit('snapshot', { procs: detected, byWorktreePath, portsByWorktreePath });
  }
}

// ── helpers (exported for tests) ───────────────────────────────────────────

/**
 * Return the path from `candidates` that is the longest prefix of `target`.
 * Equivalent to dashboard.rs:295-307. Assumes paths are absolute and use `/`.
 */
export function longestPrefixMatch(candidates: string[], target: string): string | null {
  let best: string | null = null;
  for (const c of candidates) {
    if (target === c || target.startsWith(c.endsWith('/') ? c : c + '/')) {
      if (!best || c.length > best.length) best = c;
    }
  }
  return best;
}

export function indexByWorktreePath(
  procs: DetectedProcess[],
  worktreePaths: string[],
): Record<string, DetectedProcess[]> {
  const out: Record<string, DetectedProcess[]> = {};
  for (const p of procs) {
    const wt = longestPrefixMatch(worktreePaths, p.cwd);
    if (!wt) continue;
    (out[wt] ?? (out[wt] = [])).push(p);
  }
  return out;
}

/**
 * Attribute listening ports to worktrees by the same longest-prefix match used
 * for processes. Listeners whose owning pid had no resolvable cwd, or whose cwd
 * matches no known worktree, are dropped. Each worktree's port list is deduped
 * and sorted ascending so the renderer can show stable `:3000 :5173` chips.
 */
export function indexPortsByWorktreePath(
  listeners: ListenerWithCwd[],
  worktreePaths: string[],
): Record<string, number[]> {
  const sets = new Map<string, Set<number>>();
  for (const l of listeners) {
    if (!l.cwd) continue;
    const wt = longestPrefixMatch(worktreePaths, l.cwd);
    if (!wt) continue;
    let set = sets.get(wt);
    if (!set) {
      set = new Set<number>();
      sets.set(wt, set);
    }
    set.add(l.port);
  }
  const out: Record<string, number[]> = {};
  for (const [wt, set] of sets) {
    out[wt] = [...set].sort((a, b) => a - b);
  }
  return out;
}

/**
 * Parse cputime strings as emitted by `ps -o time`:
 *   `MM:SS.ss`         e.g. `01:23.45` → 83.45
 *   `HH:MM:SS`         e.g. `02:00:00` → 7200
 *   `D-HH:MM:SS`       e.g. `1-00:00:00` → 86400
 * Mirrors dashboard.rs:389-411.
 */
export function parseCputime(s: string): number {
  let rest = s;
  let days = 0;
  const dash = s.indexOf('-');
  if (dash >= 0) {
    days = Number(s.slice(0, dash)) || 0;
    rest = s.slice(dash + 1);
  }
  const parts = rest.split(':').map(Number);
  let total = days * 86400;
  if (parts.length === 1) total += parts[0] || 0;
  else if (parts.length === 2) total += (parts[0] || 0) * 60 + (parts[1] || 0);
  else if (parts.length === 3) {
    total += (parts[0] || 0) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0);
  }
  return total;
}

export function parsePsProcesses(output: string): {
  pid: number;
  time: string;
  command: string;
}[] {
  const out: { pid: number; time: string; command: string }[] = [];
  for (const raw of output.split('\n')) {
    const line = raw.trimStart();
    if (line.length === 0) continue;
    const m = line.match(/^(\d+)\s+(\S+)\s+(.+)$/);
    if (!m || !m[1] || !m[2] || !m[3]) continue;
    out.push({
      pid: Number(m[1]),
      time: m[2],
      command: m[3].trimStart(),
    });
  }
  return out;
}

export function commandToKind(cmd: string): ProcessKind | null {
  const first = cmd.trimStart().split(/\s+/, 1)[0] ?? '';
  const base = basename(first);
  return KIND_BY_BASENAME[base] ?? null;
}

// ── default ps + lsof scanner ──────────────────────────────────────────────

async function defaultScan(): Promise<RawProcess[]> {
  const { stdout } = await run('ps', ['-axo', 'pid=,time=,command='], {
    timeoutMs: 4_000,
    throwOnError: false,
  });
  const rows = parsePsProcesses(stdout);

  const candidates = rows
    .map((r) => ({ ...r, kind: commandToKind(r.command) }))
    .filter((r): r is typeof r & { kind: ProcessKind } => r.kind !== null);

  if (candidates.length === 0) return [];

  // Resolve cwd via lsof in parallel — Rust ran this serially.
  const cwds = await Promise.all(candidates.map((c) => cwdForPid(c.pid)));

  const out: RawProcess[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const cwd = cwds[i];
    if (!c || !cwd) continue;
    out.push({ pid: c.pid, kind: c.kind, cwd, cputime: parseCputime(c.time) });
  }
  return out;
}

// ── default lsof listening-port scanner ────────────────────────────────────

/**
 * Parse the default (column) output of `lsof -iTCP -sTCP:LISTEN -nP`. Each data
 * row looks like:
 *   `node  12345 dom  23u  IPv4 0x..  0t0  TCP *:3000 (LISTEN)`
 *   `node  12345 dom  24u  IPv6 0x..  0t0  TCP [::1]:5173 (LISTEN)`
 * We pull the PID (2nd column) and the port from the trailing `:PORT` of the
 * NAME column. Header rows and rows without a numeric port are skipped. The same
 * pid may listen on several ports (multiple rows) — each is returned separately;
 * dedup happens later in {@link indexPortsByWorktreePath}.
 */
export function parseLsofListen(stdout: string): Listener[] {
  const out: Listener[] = [];
  for (const raw of stdout.split('\n')) {
    const line = raw.trim();
    if (line.length === 0) continue;
    const cols = line.split(/\s+/);
    // Skip the header row ("COMMAND PID USER ...").
    if (cols[0] === 'COMMAND') continue;
    const pid = Number(cols[1]);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    // NAME is the second-to-last column ("(LISTEN)" trails it); fall back to
    // the last if there's no parenthesised state.
    const name =
      cols[cols.length - 1] === '(LISTEN)' ? cols[cols.length - 2] : cols[cols.length - 1];
    if (!name) continue;
    const colon = name.lastIndexOf(':');
    if (colon < 0) continue;
    const port = Number(name.slice(colon + 1));
    if (!Number.isInteger(port) || port <= 0) continue;
    out.push({ pid, port });
  }
  return out;
}

/**
 * Per-pid cwd cache for the port scan. lsof's per-pid cwd probe is heavy, so we
 * resolve a pid's cwd at most once and reuse it across ticks. The cache is
 * pruned each scan to the pids still listening, so dead pids don't accumulate.
 */
const portCwdCache = new Map<number, string | null>();

async function defaultPortScan(): Promise<ListenerWithCwd[]> {
  const { stdout } = await run('lsof', ['-iTCP', '-sTCP:LISTEN', '-nP'], {
    timeoutMs: 4_000,
    throwOnError: false,
  });
  const listeners = parseLsofListen(stdout);

  const pids = [...new Set(listeners.map((l) => l.pid))];

  // Only probe pids we haven't already resolved — lsof is expensive.
  const unresolved = pids.filter((pid) => !portCwdCache.has(pid));
  const resolved = await Promise.all(unresolved.map((pid) => cwdForPid(pid)));
  unresolved.forEach((pid, i) => portCwdCache.set(pid, resolved[i] ?? null));

  // Prune the cache down to the pids still listening this tick.
  const live = new Set(pids);
  for (const pid of portCwdCache.keys()) {
    if (!live.has(pid)) portCwdCache.delete(pid);
  }

  return listeners.map((l) => ({ ...l, cwd: portCwdCache.get(l.pid) ?? null }));
}

async function cwdForPid(pid: number): Promise<string | null> {
  const { stdout } = await run('lsof', ['-a', '-d', 'cwd', '-p', String(pid), '-Fn'], {
    timeoutMs: 2_000,
    throwOnError: false,
  });
  for (const line of stdout.split('\n')) {
    if (line.startsWith('n')) return line.slice(1);
  }
  return null;
}
