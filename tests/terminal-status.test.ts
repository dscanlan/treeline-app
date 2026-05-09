import { describe, expect, it, vi } from 'vitest';
import {
  computeStatus,
  parsePsOutput,
  TerminalStatusMonitor,
  type ProcEntry,
} from '../src/main/terminal-status';
import type { TerminalStatusUpdate } from '@shared/types';

function buckets(rows: ProcEntry[]): Map<number, ProcEntry[]> {
  const m = new Map<number, ProcEntry[]>();
  for (const p of rows) {
    const a = m.get(p.ppid);
    if (a) a.push(p);
    else m.set(p.ppid, [p]);
  }
  return m;
}

describe('parsePsOutput', () => {
  it('parses pid ppid comm rows', () => {
    const out = parsePsOutput('  1  0 launchd\n 12345  1 /bin/zsh\n 99999 12345 /usr/bin/sleep\n');
    expect(out).toEqual([
      { pid: 1, ppid: 0, comm: 'launchd' },
      { pid: 12345, ppid: 1, comm: 'zsh' },
      { pid: 99999, ppid: 12345, comm: 'sleep' },
    ]);
  });
  it('skips blanks and malformed rows', () => {
    expect(parsePsOutput('\n\nbad\n  1  0 init\n')).toEqual([
      { pid: 1, ppid: 0, comm: 'init' },
    ]);
  });
});

describe('computeStatus', () => {
  it('reports idle when the shell exists but has no children', () => {
    const m = buckets([
      { pid: 100, ppid: 1, comm: 'zsh' }, // the shell itself
    ]);
    expect(computeStatus(100, m)).toEqual({ status: 'idle', foregroundCmd: null });
  });

  it('reports running with the most-recent child as foregroundCmd', () => {
    const m = buckets([
      { pid: 100, ppid: 1, comm: 'zsh' },
      { pid: 200, ppid: 100, comm: 'claude' },
      { pid: 250, ppid: 100, comm: 'sleep' },
    ]);
    expect(computeStatus(100, m)).toEqual({ status: 'running', foregroundCmd: 'sleep' });
  });

  it('reports exited when neither the shell nor any of its children appear', () => {
    const m = buckets([{ pid: 1, ppid: 0, comm: 'launchd' }]);
    expect(computeStatus(999, m)).toEqual({ status: 'exited', foregroundCmd: null });
  });
});

describe('TerminalStatusMonitor', () => {
  it('emits delta updates only when status changes', async () => {
    const ticks: ProcEntry[][] = [
      [{ pid: 100, ppid: 1, comm: 'zsh' }], // tick 1: idle
      [{ pid: 100, ppid: 1, comm: 'zsh' }], // tick 2: still idle — should NOT emit
      [
        { pid: 100, ppid: 1, comm: 'zsh' },
        { pid: 200, ppid: 100, comm: 'claude' },
      ], // tick 3: running claude
      [
        { pid: 100, ppid: 1, comm: 'zsh' },
        { pid: 200, ppid: 100, comm: 'claude' },
      ], // tick 4: still running — no emit
      [{ pid: 100, ppid: 1, comm: 'zsh' }], // tick 5: idle again
      [], // tick 6: shell gone → exited
    ];

    const mon = new TerminalStatusMonitor(1000, async () => ticks.shift() ?? []);
    mon.register('pty-a', 100);
    const events: TerminalStatusUpdate[][] = [];
    mon.on('updates', (u: TerminalStatusUpdate[]) => events.push(u));

    await mon.tick(); // first scan: idle is the initial state, no emit
    await mon.tick(); // still idle, no emit
    await mon.tick(); // running claude → emit
    await mon.tick(); // still running, no emit
    await mon.tick(); // back to idle → emit
    await mon.tick(); // exited → emit

    expect(events.flat()).toEqual([
      { ptyId: 'pty-a', status: 'running', foregroundCmd: 'claude' },
      { ptyId: 'pty-a', status: 'idle', foregroundCmd: null },
      { ptyId: 'pty-a', status: 'exited', foregroundCmd: null },
    ]);
  });

  it('start()/stop() drives the timer and unregister halts updates', async () => {
    vi.useFakeTimers();
    try {
      const scan = vi.fn(async () => [] as ProcEntry[]);
      const mon = new TerminalStatusMonitor(100, scan);
      mon.register('p', 42);
      mon.start();
      await vi.advanceTimersByTimeAsync(250);
      const callsBefore = scan.mock.calls.length;
      expect(callsBefore).toBeGreaterThan(0);

      mon.stop();
      const callsAtStop = scan.mock.calls.length;
      await vi.advanceTimersByTimeAsync(250);
      expect(scan.mock.calls.length).toBe(callsAtStop);
    } finally {
      vi.useRealTimers();
    }
  });
});
