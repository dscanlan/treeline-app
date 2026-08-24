import { describe, expect, it, vi } from 'vitest';
import {
  PtyManager,
  sanitizeEnv,
  type CwdProbe,
  type IPtyLike,
  type PtyCwdChangedEvent,
  type PtyDataEvent,
  type PtyExitEvent,
  type PtyNotificationEvent,
  type PtySpawnedEvent,
  type SpawnFn,
} from '../src/main/pty-manager';

class FakePty implements IPtyLike {
  pid = 4242;
  written: string[] = [];
  resized: { cols: number; rows: number }[] = [];
  killed: string | undefined;
  private dataCb: ((c: string) => void) | null = null;
  private exitCb: ((e: { exitCode: number; signal?: number | null }) => void) | null = null;

  onData(cb: (c: string) => void) {
    this.dataCb = cb;
    return { dispose: () => (this.dataCb = null) };
  }
  onExit(cb: (e: { exitCode: number; signal?: number | null }) => void) {
    this.exitCb = cb;
    return { dispose: () => (this.exitCb = null) };
  }
  write(data: string): void {
    this.written.push(data);
  }
  resize(cols: number, rows: number): void {
    this.resized.push({ cols, rows });
  }
  kill(signal?: string): void {
    this.killed = signal;
    // Mimic real node-pty: SIGHUP causes onExit to fire shortly after.
    setImmediate(() => this.exitCb?.({ exitCode: 0, signal: 1 }));
  }

  // Test helpers:
  emitData(chunk: string): void {
    this.dataCb?.(chunk);
  }
  emitExit(code: number, signal: number | null = null): void {
    this.exitCb?.({ exitCode: code, signal });
  }
}

const flushSetImmediate = () => new Promise((resolve) => setImmediate(resolve));

describe('PtyManager', () => {
  it('spawn() returns an id and emits a "spawned" event with the shell pid', () => {
    const fake = new FakePty();
    const spawnFn: SpawnFn = () => fake;
    const mgr = new PtyManager(spawnFn, undefined, 0);

    const events: PtySpawnedEvent[] = [];
    mgr.on('spawned', (e) => events.push(e as PtySpawnedEvent));

    const { id, shellPid } = mgr.spawn({ cwd: '/tmp', cols: 80, rows: 24 });
    expect(id).toMatch(/[0-9a-f-]{36}/);
    expect(shellPid).toBe(4242);
    expect(events).toEqual([{ id, shellPid: 4242 }]);
  });

  it('passes the new PTY id to spawnFn as paneId (for TREELINE_PANE_ID)', () => {
    const fake = new FakePty();
    const seen: (string | undefined)[] = [];
    const spawnFn: SpawnFn = (opts) => {
      seen.push(opts.paneId);
      return fake;
    };
    const mgr = new PtyManager(spawnFn, undefined, 0);

    const { id } = mgr.spawn({ cwd: '/tmp', cols: 80, rows: 24 });
    expect(seen).toEqual([id]);
  });

  it('coalesces multiple data chunks into a single tick-flushed event', async () => {
    const fake = new FakePty();
    const mgr = new PtyManager(() => fake, undefined, 0);
    const events: PtyDataEvent[] = [];
    mgr.on('data', (e) => events.push(e as PtyDataEvent));
    const { id } = mgr.spawn({ cwd: '/tmp', cols: 80, rows: 24 });

    fake.emitData('foo');
    fake.emitData('bar');
    fake.emitData('baz');
    expect(events).toHaveLength(0); // Not yet flushed.
    await flushSetImmediate();
    expect(events).toEqual([{ id, chunk: 'foobarbaz' }]);
  });

  it('flushes pending data before emitting exit', async () => {
    const fake = new FakePty();
    const mgr = new PtyManager(() => fake, undefined, 0);
    const seen: string[] = [];
    mgr.on('data', (e: PtyDataEvent) => seen.push('data:' + e.chunk));
    mgr.on('exit', () => seen.push('exit'));
    mgr.spawn({ cwd: '/tmp', cols: 80, rows: 24 });

    fake.emitData('hello');
    fake.emitExit(0);
    expect(seen).toEqual(['data:hello', 'exit']);
  });

  it('write/resize forwards to the underlying pty', () => {
    const fake = new FakePty();
    const mgr = new PtyManager(() => fake, undefined, 0);
    const { id } = mgr.spawn({ cwd: '/tmp', cols: 80, rows: 24 });
    expect(mgr.write(id, 'pwd\n')).toBe(true);
    expect(mgr.write('missing', 'ignored')).toBe(false);
    mgr.resize(id, 100, 30);
    expect(fake.written).toEqual(['pwd\n']);
    expect(fake.resized).toEqual([{ cols: 100, rows: 30 }]);
  });

  it('resize clamps non-positive dims to 1', () => {
    const fake = new FakePty();
    const mgr = new PtyManager(() => fake, undefined, 0);
    const { id } = mgr.spawn({ cwd: '/tmp', cols: 80, rows: 24 });
    mgr.resize(id, 0, -5);
    expect(fake.resized).toEqual([{ cols: 1, rows: 1 }]);
  });

  it('kill() sends SIGHUP and resolves on exit', async () => {
    const fake = new FakePty();
    const mgr = new PtyManager(() => fake, undefined, 0);
    const { id } = mgr.spawn({ cwd: '/tmp', cols: 80, rows: 24 });

    const promise = mgr.kill(id);
    await promise;
    expect(fake.killed).toBe('SIGHUP');
    expect(mgr.has(id)).toBe(false);
  });

  it('kill() escalates to SIGKILL after the grace period if the proc never exits', async () => {
    vi.useFakeTimers();
    try {
      class StubbornPty extends FakePty {
        override kill(signal?: string): void {
          this.killed = signal;
          // Do NOT fire onExit on SIGHUP — only on the second kill.
          if (signal === 'SIGKILL') {
            setImmediate(() => this.emitExit(137, 9));
          }
        }
      }
      const fake = new StubbornPty();
      const mgr = new PtyManager(() => fake, undefined, 0);
      const { id } = mgr.spawn({ cwd: '/tmp', cols: 80, rows: 24 });

      const promise = mgr.kill(id, 50);
      await vi.advanceTimersByTimeAsync(60);
      vi.useRealTimers();
      await promise;
      expect(fake.killed).toBe('SIGKILL');
      expect(mgr.has(id)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('on natural exit, the entry is removed', async () => {
    const fake = new FakePty();
    const mgr = new PtyManager(() => fake, undefined, 0);
    const { id } = mgr.spawn({ cwd: '/tmp', cols: 80, rows: 24 });
    expect(mgr.has(id)).toBe(true);
    fake.emitExit(0);
    expect(mgr.has(id)).toBe(false);
  });

  it('shellPids() lists all live PTYs', () => {
    const a = new FakePty();
    a.pid = 1;
    const b = new FakePty();
    b.pid = 2;
    const queue = [a, b];
    const mgr = new PtyManager(() => queue.shift()!, undefined, 0);
    const r1 = mgr.spawn({ cwd: '/tmp', cols: 80, rows: 24 });
    const r2 = mgr.spawn({ cwd: '/tmp', cols: 80, rows: 24 });
    expect(mgr.shellPids().sort((x, y) => x.shellPid - y.shellPid)).toEqual([
      { id: r1.id, shellPid: 1 },
      { id: r2.id, shellPid: 2 },
    ]);
  });

  it('list() snapshots each live PTY with its id and cwd (for reload re-attach)', () => {
    const a = new FakePty();
    a.pid = 1;
    const b = new FakePty();
    b.pid = 2;
    const queue = [a, b];
    const mgr = new PtyManager(() => queue.shift()!, undefined, 0);
    const r1 = mgr.spawn({ cwd: '/repo/main', cols: 80, rows: 24 });
    const r2 = mgr.spawn({ cwd: '/repo/feat', cols: 80, rows: 24 });

    expect(mgr.list().sort((x, y) => x.cwd.localeCompare(y.cwd))).toEqual([
      { id: r2.id, cwd: '/repo/feat' },
      { id: r1.id, cwd: '/repo/main' },
    ]);
  });

  it('list() echoes scratchLabel for scratch PTYs so a reload can rebuild the row', () => {
    const scratch = new FakePty();
    scratch.pid = 1;
    const plain = new FakePty();
    plain.pid = 2;
    const queue = [scratch, plain];
    const mgr = new PtyManager(() => queue.shift()!, undefined, 0);
    const s = mgr.spawn({ cwd: '/home/me', cols: 80, rows: 24, scratchLabel: 'Scratch 2' });
    const p = mgr.spawn({ cwd: '/repo', cols: 80, rows: 24 });

    const byId = new Map(mgr.list().map((e) => [e.id, e]));
    // The scratch PTY carries its sidebar label…
    expect(byId.get(s.id)).toEqual({ id: s.id, cwd: '/home/me', scratchLabel: 'Scratch 2' });
    // …while an ordinary terminal omits the key entirely (no spurious row on reload).
    expect(byId.get(p.id)).toEqual({ id: p.id, cwd: '/repo' });
    expect('scratchLabel' in byId.get(p.id)!).toBe(false);
  });

  it('setAgentSession records a kind-tagged id echoed by agentSessionIds; unknown panes are dropped', () => {
    const mgr = new PtyManager(() => new FakePty(), undefined, 0);
    const { id } = mgr.spawn({ cwd: '/tmp', cols: 80, rows: 24 });

    expect(mgr.agentSessionIds()).toEqual({});
    expect(mgr.setAgentSession('no-such-pane', 'claude', 'sess-x')).toBe(false);
    expect(mgr.agentSessionIds()).toEqual({});

    expect(mgr.setAgentSession(id, 'claude', 'sess-1')).toBe(true);
    expect(mgr.agentSessionIds()).toEqual({ [id]: { kind: 'claude', sessionId: 'sess-1' } });

    // A re-report (new session / --resume / /clear in the same pane) overwrites —
    // including one from a different agent taking over the pane.
    expect(mgr.setAgentSession(id, 'opencode', 'sess-2')).toBe(true);
    expect(mgr.agentSessionIds()).toEqual({ [id]: { kind: 'opencode', sessionId: 'sess-2' } });
  });

  it('agentSessionIds drops an entry once its PTY exits', () => {
    const fake = new FakePty();
    const mgr = new PtyManager(() => fake, undefined, 0);
    const { id } = mgr.spawn({ cwd: '/tmp', cols: 80, rows: 24 });
    mgr.setAgentSession(id, 'claude', 'sess-1');

    fake.emitExit(0);
    expect(mgr.agentSessionIds()).toEqual({});
  });

  it("list() reflects a PTY's latest cwd after an OSC 7 change", async () => {
    const fake = new FakePty();
    const mgr = new PtyManager(() => fake, undefined, 0);
    const { id } = mgr.spawn({ cwd: '/tmp', cols: 80, rows: 24 });

    fake.emitData('\x1b]7;file://host/tmp/moved\x07');
    await flushSetImmediate();

    expect(mgr.list()).toEqual([{ id, cwd: '/tmp/moved' }]);
  });

  it('list() drops a PTY once it exits (so no orphan is offered for re-attach)', () => {
    const fake = new FakePty();
    const mgr = new PtyManager(() => fake, undefined, 0);
    mgr.spawn({ cwd: '/tmp', cols: 80, rows: 24 });
    fake.emitExit(0);
    expect(mgr.list()).toEqual([]);
  });

  it('exit event carries code and signal', async () => {
    const fake = new FakePty();
    const mgr = new PtyManager(() => fake, undefined, 0);
    const events: PtyExitEvent[] = [];
    mgr.on('exit', (e) => events.push(e as PtyExitEvent));
    const { id } = mgr.spawn({ cwd: '/tmp', cols: 80, rows: 24 });
    fake.emitExit(137, 9);
    expect(events).toEqual([{ id, code: 137, signal: 9 }]);
  });

  // ── cwd tracking ─────────────────────────────────────────────────────────

  it('emits cwd-changed with opts.cwd immediately on spawn', () => {
    const fake = new FakePty();
    const mgr = new PtyManager(() => fake, undefined, 0);
    const events: PtyCwdChangedEvent[] = [];
    mgr.on('cwd-changed', (e) => events.push(e as PtyCwdChangedEvent));
    const { id } = mgr.spawn({ cwd: '/Users/me/repo', cols: 80, rows: 24 });
    expect(events).toEqual([{ id, cwd: '/Users/me/repo' }]);
    expect(mgr.cwdOf(id)).toBe('/Users/me/repo');
  });

  it('parses an OSC 7 cwd notification (BEL terminator) and emits cwd-changed', () => {
    const fake = new FakePty();
    const mgr = new PtyManager(() => fake, undefined, 0);
    const events: PtyCwdChangedEvent[] = [];
    mgr.on('cwd-changed', (e) => events.push(e as PtyCwdChangedEvent));
    const { id } = mgr.spawn({ cwd: '/start', cols: 80, rows: 24 });
    // Apple's stock zsh emits exactly this format.
    fake.emitData('\x1b]7;file://hostname/Users/me/other%20repo\x07$ ');
    expect(events).toEqual([
      { id, cwd: '/start' },
      { id, cwd: '/Users/me/other repo' },
    ]);
    expect(mgr.cwdOf(id)).toBe('/Users/me/other repo');
  });

  it('parses an OSC 7 with the ESC \\ string terminator', () => {
    const fake = new FakePty();
    const mgr = new PtyManager(() => fake, undefined, 0);
    const events: PtyCwdChangedEvent[] = [];
    mgr.on('cwd-changed', (e) => events.push(e as PtyCwdChangedEvent));
    const { id } = mgr.spawn({ cwd: '/start', cols: 80, rows: 24 });
    fake.emitData('\x1b]7;file:///tmp/x\x1b\\');
    expect(events.at(-1)).toEqual({ id, cwd: '/tmp/x' });
  });

  it('reassembles an OSC 7 sequence split across two chunks', () => {
    const fake = new FakePty();
    const mgr = new PtyManager(() => fake, undefined, 0);
    const events: PtyCwdChangedEvent[] = [];
    mgr.on('cwd-changed', (e) => events.push(e as PtyCwdChangedEvent));
    const { id } = mgr.spawn({ cwd: '/start', cols: 80, rows: 24 });
    fake.emitData('output\x1b]7;file://h/Users/me/');
    fake.emitData('split-path\x07more output');
    expect(events.at(-1)).toEqual({ id, cwd: '/Users/me/split-path' });
  });

  it('does not re-emit cwd-changed when OSC 7 reports the same path', () => {
    const fake = new FakePty();
    const mgr = new PtyManager(() => fake, undefined, 0);
    const events: PtyCwdChangedEvent[] = [];
    mgr.on('cwd-changed', (e) => events.push(e as PtyCwdChangedEvent));
    mgr.spawn({ cwd: '/Users/me/repo', cols: 80, rows: 24 });
    fake.emitData('\x1b]7;file://h/Users/me/repo\x07');
    fake.emitData('\x1b]7;file://h/Users/me/repo\x07');
    expect(events).toHaveLength(1); // only the spawn-time emit
  });

  it('ignores malformed OSC 7 bodies that are not file:// URLs', () => {
    const fake = new FakePty();
    const mgr = new PtyManager(() => fake, undefined, 0);
    const events: PtyCwdChangedEvent[] = [];
    mgr.on('cwd-changed', (e) => events.push(e as PtyCwdChangedEvent));
    mgr.spawn({ cwd: '/start', cols: 80, rows: 24 });
    fake.emitData('\x1b]7;not-a-url\x07');
    fake.emitData('\x1b]7;\x07'); // empty body
    expect(events).toHaveLength(1); // still just the spawn emit
  });

  it('falls back to the cwd probe when no OSC 7 has been seen', async () => {
    vi.useFakeTimers();
    try {
      const fake = new FakePty();
      const probeCalls: number[] = [];
      const probe: CwdProbe = async (pid) => {
        probeCalls.push(pid);
        return '/probed/path';
      };
      const mgr = new PtyManager(() => fake, probe, 100);
      const events: PtyCwdChangedEvent[] = [];
      mgr.on('cwd-changed', (e) => events.push(e as PtyCwdChangedEvent));
      const { id } = mgr.spawn({ cwd: '/start', cols: 80, rows: 24 });

      await vi.advanceTimersByTimeAsync(105);
      // The probe runs inside an async arrow; one more microtask flush.
      await vi.advanceTimersByTimeAsync(0);

      expect(probeCalls).toEqual([fake.pid]);
      expect(events).toEqual([
        { id, cwd: '/start' },
        { id, cwd: '/probed/path' },
      ]);

      // Stop the timer so vitest exits cleanly.
      fake.emitExit(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('skips the cwd probe when OSC 7 was observed within 2 poll intervals', async () => {
    vi.useFakeTimers();
    try {
      const fake = new FakePty();
      const probeCalls: number[] = [];
      const probe: CwdProbe = async (pid) => {
        probeCalls.push(pid);
        return '/should-not-be-used';
      };
      const mgr = new PtyManager(() => fake, probe, 100);
      mgr.spawn({ cwd: '/start', cols: 80, rows: 24 });

      // Recent OSC 7 observation — probe must back off.
      fake.emitData('\x1b]7;file://h/from-osc\x07');
      await vi.advanceTimersByTimeAsync(105);
      await vi.advanceTimersByTimeAsync(0);
      expect(probeCalls).toEqual([]);

      fake.emitExit(0);
    } finally {
      vi.useRealTimers();
    }
  });

  // ── agent-attention notifications (OSC 9 / 99 / 777) ───────────────────────

  const collectNotifications = (mgr: PtyManager): PtyNotificationEvent[] => {
    const out: PtyNotificationEvent[] = [];
    mgr.on('notification', (e) => out.push(e as PtyNotificationEvent));
    return out;
  };

  it('emits a notification for an OSC 9 (iTerm growl) sequence', () => {
    const fake = new FakePty();
    const mgr = new PtyManager(() => fake, undefined, 0);
    const notes = collectNotifications(mgr);
    const { id } = mgr.spawn({ cwd: '/tmp', cols: 80, rows: 24 });
    fake.emitData('\x1b]9;Build finished\x07');
    expect(notes).toEqual([{ id, text: 'Build finished' }]);
  });

  it('ignores ConEmu OSC 9 progress subcommands (9;<digit>;…)', () => {
    const fake = new FakePty();
    const mgr = new PtyManager(() => fake, undefined, 0);
    const notes = collectNotifications(mgr);
    mgr.spawn({ cwd: '/tmp', cols: 80, rows: 24 });
    fake.emitData('\x1b]9;4;1;50\x07'); // progress, not a notification
    expect(notes).toEqual([]);
  });

  it('parses an OSC 777 notify;title;body sequence', () => {
    const fake = new FakePty();
    const mgr = new PtyManager(() => fake, undefined, 0);
    const notes = collectNotifications(mgr);
    const { id } = mgr.spawn({ cwd: '/tmp', cols: 80, rows: 24 });
    fake.emitData('\x1b]777;notify;Claude;needs your input\x07');
    expect(notes).toEqual([{ id, text: 'Claude: needs your input' }]);
  });

  it('ignores non-notify OSC 777 subcommands', () => {
    const fake = new FakePty();
    const mgr = new PtyManager(() => fake, undefined, 0);
    const notes = collectNotifications(mgr);
    mgr.spawn({ cwd: '/tmp', cols: 80, rows: 24 });
    fake.emitData('\x1b]777;precmd\x07');
    expect(notes).toEqual([]);
  });

  it('parses an OSC 99 (kitty) notification payload with the ST terminator', () => {
    const fake = new FakePty();
    const mgr = new PtyManager(() => fake, undefined, 0);
    const notes = collectNotifications(mgr);
    const { id } = mgr.spawn({ cwd: '/tmp', cols: 80, rows: 24 });
    fake.emitData('\x1b]99;i=1:d=0;Done\x1b\\');
    expect(notes).toEqual([{ id, text: 'Done' }]);
  });

  it('decodes a base64 OSC 99 payload when metadata says e=1', () => {
    const fake = new FakePty();
    const mgr = new PtyManager(() => fake, undefined, 0);
    const notes = collectNotifications(mgr);
    const { id } = mgr.spawn({ cwd: '/tmp', cols: 80, rows: 24 });
    const b64 = Buffer.from('Ready for review', 'utf8').toString('base64');
    fake.emitData(`\x1b]99;e=1;${b64}\x07`);
    expect(notes).toEqual([{ id, text: 'Ready for review' }]);
  });

  it('reassembles a notification split across two chunks', () => {
    const fake = new FakePty();
    const mgr = new PtyManager(() => fake, undefined, 0);
    const notes = collectNotifications(mgr);
    const { id } = mgr.spawn({ cwd: '/tmp', cols: 80, rows: 24 });
    fake.emitData('logs\x1b]9;Tests ');
    fake.emitData('passed\x07more');
    expect(notes).toEqual([{ id, text: 'Tests passed' }]);
  });

  it('does not treat window-title (OSC 0/2) sequences as notifications', () => {
    const fake = new FakePty();
    const mgr = new PtyManager(() => fake, undefined, 0);
    const notes = collectNotifications(mgr);
    const cwds: PtyCwdChangedEvent[] = [];
    mgr.on('cwd-changed', (e) => cwds.push(e as PtyCwdChangedEvent));
    const { id } = mgr.spawn({ cwd: '/start', cols: 80, rows: 24 });
    // A title set, then a real cwd OSC 7 — the title must not pollute the tail.
    fake.emitData('\x1b]0;my-shell\x07\x1b]7;file://h/Users/me/x\x07');
    expect(notes).toEqual([]);
    expect(cwds.at(-1)).toEqual({ id, cwd: '/Users/me/x' });
  });

  it('clears the cwd-poll timer on natural exit', async () => {
    vi.useFakeTimers();
    try {
      const fake = new FakePty();
      const probeCalls: number[] = [];
      const probe: CwdProbe = async (pid) => {
        probeCalls.push(pid);
        return null;
      };
      const mgr = new PtyManager(() => fake, probe, 50);
      mgr.spawn({ cwd: '/start', cols: 80, rows: 24 });
      fake.emitExit(0);

      await vi.advanceTimersByTimeAsync(500);
      expect(probeCalls).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('sanitizeEnv', () => {
  it('strips Electron-only vars and forces a truecolor TERM', () => {
    const out = sanitizeEnv({
      PATH: '/usr/bin',
      ELECTRON_RUN_AS_NODE: '1',
      ELECTRON_NO_ATTACH_CONSOLE: '1',
      NODE_OPTIONS: '--foo',
      KEEP: 'yes',
    });
    expect(out.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(out.NODE_OPTIONS).toBeUndefined();
    expect(out.KEEP).toBe('yes');
    expect(out.TERM).toBe('xterm-256color');
    expect(out.COLORTERM).toBe('truecolor');
  });

  it('prepends the managed bin dir to PATH', () => {
    const out = sanitizeEnv({ PATH: '/usr/bin:/bin' }, '/tl/bin');
    expect(out.PATH).toBe('/tl/bin:/usr/bin:/bin');
  });

  it('does not duplicate the bin dir if already on PATH', () => {
    const out = sanitizeEnv({ PATH: '/tl/bin:/usr/bin' }, '/tl/bin');
    expect(out.PATH).toBe('/tl/bin:/usr/bin');
  });

  it('sets PATH to the bin dir when PATH is empty', () => {
    const out = sanitizeEnv({}, '/tl/bin');
    expect(out.PATH).toBe('/tl/bin');
  });

  it('leaves PATH untouched when no bin dir is given', () => {
    const out = sanitizeEnv({ PATH: '/usr/bin' });
    expect(out.PATH).toBe('/usr/bin');
  });

  it('exports TREELINE_PANE_ID when a pane id is given', () => {
    const out = sanitizeEnv({ PATH: '/usr/bin' }, null, 'pane-123');
    expect(out.TREELINE_PANE_ID).toBe('pane-123');
  });

  it('omits TREELINE_PANE_ID when no pane id is given', () => {
    const out = sanitizeEnv({ PATH: '/usr/bin' });
    expect(out.TREELINE_PANE_ID).toBeUndefined();
  });
});

describe('PtyManager pause/resume', () => {
  function makeMgr() {
    const fake = new FakePty();
    const signals: { pid: number; signal: string }[] = [];
    // Subtree: shell (4242) → agent (100) → tool (101).
    const subtreeProbe = vi.fn(async (root: number) =>
      root === 4242 ? [4242, 100, 101] : [root],
    );
    const signalFn = (pid: number, signal: NodeJS.Signals) =>
      signals.push({ pid, signal });
    const mgr = new PtyManager(() => fake, undefined, 0, subtreeProbe, signalFn);
    return { mgr, signals, subtreeProbe };
  }

  it('pause() SIGSTOPs the whole subtree, leaves-first', async () => {
    const { mgr, signals } = makeMgr();
    const { id } = mgr.spawn({ cwd: '/tmp', cols: 80, rows: 24 });

    expect(await mgr.pause(id)).toBe(true);
    expect(signals).toEqual([
      { pid: 101, signal: 'SIGSTOP' },
      { pid: 100, signal: 'SIGSTOP' },
      { pid: 4242, signal: 'SIGSTOP' },
    ]);
    expect(mgr.isPaused(id)).toBe(true);
  });

  it('resume() SIGCONTs the subtree root-first and clears the flag', async () => {
    const { mgr, signals } = makeMgr();
    const { id } = mgr.spawn({ cwd: '/tmp', cols: 80, rows: 24 });
    await mgr.pause(id);
    signals.length = 0;

    expect(await mgr.resume(id)).toBe(true);
    expect(signals).toEqual([
      { pid: 4242, signal: 'SIGCONT' },
      { pid: 100, signal: 'SIGCONT' },
      { pid: 101, signal: 'SIGCONT' },
    ]);
    expect(mgr.isPaused(id)).toBe(false);
  });

  it('pause()/resume() return false for an unknown pty and signal nothing', async () => {
    const { mgr, signals } = makeMgr();
    expect(await mgr.pause('nope')).toBe(false);
    expect(await mgr.resume('nope')).toBe(false);
    expect(signals).toEqual([]);
  });

  it('isPaused() defaults to false for a freshly-spawned pty', () => {
    const { mgr } = makeMgr();
    const { id } = mgr.spawn({ cwd: '/tmp', cols: 80, rows: 24 });
    expect(mgr.isPaused(id)).toBe(false);
  });
});
