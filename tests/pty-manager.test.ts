import { describe, expect, it, vi } from 'vitest';
import {
  PtyManager,
  type IPtyLike,
  type PtyDataEvent,
  type PtyExitEvent,
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
    const mgr = new PtyManager(spawnFn);

    const events: PtySpawnedEvent[] = [];
    mgr.on('spawned', (e) => events.push(e as PtySpawnedEvent));

    const { id, shellPid } = mgr.spawn({ cwd: '/tmp', cols: 80, rows: 24 });
    expect(id).toMatch(/[0-9a-f-]{36}/);
    expect(shellPid).toBe(4242);
    expect(events).toEqual([{ id, shellPid: 4242 }]);
  });

  it('coalesces multiple data chunks into a single tick-flushed event', async () => {
    const fake = new FakePty();
    const mgr = new PtyManager(() => fake);
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
    const mgr = new PtyManager(() => fake);
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
    const mgr = new PtyManager(() => fake);
    const { id } = mgr.spawn({ cwd: '/tmp', cols: 80, rows: 24 });
    mgr.write(id, 'pwd\n');
    mgr.resize(id, 100, 30);
    expect(fake.written).toEqual(['pwd\n']);
    expect(fake.resized).toEqual([{ cols: 100, rows: 30 }]);
  });

  it('resize clamps non-positive dims to 1', () => {
    const fake = new FakePty();
    const mgr = new PtyManager(() => fake);
    const { id } = mgr.spawn({ cwd: '/tmp', cols: 80, rows: 24 });
    mgr.resize(id, 0, -5);
    expect(fake.resized).toEqual([{ cols: 1, rows: 1 }]);
  });

  it('kill() sends SIGHUP and resolves on exit', async () => {
    const fake = new FakePty();
    const mgr = new PtyManager(() => fake);
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
      const mgr = new PtyManager(() => fake);
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
    const mgr = new PtyManager(() => fake);
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
    const mgr = new PtyManager(() => queue.shift()!);
    const r1 = mgr.spawn({ cwd: '/tmp', cols: 80, rows: 24 });
    const r2 = mgr.spawn({ cwd: '/tmp', cols: 80, rows: 24 });
    expect(mgr.shellPids().sort((x, y) => x.shellPid - y.shellPid)).toEqual([
      { id: r1.id, shellPid: 1 },
      { id: r2.id, shellPid: 2 },
    ]);
  });

  it('exit event carries code and signal', async () => {
    const fake = new FakePty();
    const mgr = new PtyManager(() => fake);
    const events: PtyExitEvent[] = [];
    mgr.on('exit', (e) => events.push(e as PtyExitEvent));
    const { id } = mgr.spawn({ cwd: '/tmp', cols: 80, rows: 24 });
    fake.emitExit(137, 9);
    expect(events).toEqual([{ id, code: 137, signal: 9 }]);
  });
});
