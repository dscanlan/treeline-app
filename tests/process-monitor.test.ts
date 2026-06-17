import { describe, expect, it } from 'vitest';
import {
  commandToKind,
  indexByWorktreePath,
  indexPortsByWorktreePath,
  longestPrefixMatch,
  parseCputime,
  parseLsofListen,
  parsePsProcesses,
  ProcessMonitor,
  type ListenerWithCwd,
  type RawProcess,
} from '../src/main/process-monitor';
import type { DetectedProcess } from '@shared/types';

describe('parseCputime', () => {
  // Mirrors dashboard.rs unit tests at lines 418-433.
  it('parses MM:SS.hh', () => {
    expect(parseCputime('01:23.45')).toBeCloseTo(83.45, 2);
  });
  it('parses HH:MM:SS', () => {
    expect(parseCputime('02:00:00')).toBe(7200);
  });
  it('parses D-HH:MM:SS', () => {
    expect(parseCputime('1-00:00:00')).toBe(86400);
  });
  it('returns 0 for garbage', () => {
    expect(parseCputime('not-a-time')).toBe(0);
  });
});

describe('parsePsProcesses', () => {
  it('splits pid, time, and command (which may contain spaces)', () => {
    const out = parsePsProcesses(
      [
        '  12345  01:23.45 /usr/local/bin/claude --no-update-check',
        '  77777  00:00.10 sleep 60',
      ].join('\n'),
    );
    expect(out).toEqual([
      { pid: 12345, time: '01:23.45', command: '/usr/local/bin/claude --no-update-check' },
      { pid: 77777, time: '00:00.10', command: 'sleep 60' },
    ]);
  });
});

describe('commandToKind', () => {
  it('matches by basename of the first whitespace token', () => {
    expect(commandToKind('/usr/local/bin/claude --foo')).toBe('claude');
    expect(commandToKind('opencode')).toBe('opencode');
    expect(commandToKind('  /opt/bin/aider --model x')).toBe('aider');
  });
  it('rejects unknown binaries', () => {
    expect(commandToKind('node ./script.js')).toBeNull();
    expect(commandToKind('claude-code')).toBeNull(); // basename mismatch — not exactly "claude"
  });
});

describe('longestPrefixMatch', () => {
  // Mirrors dashboard.rs:436-448.
  it('picks the deepest matching candidate', () => {
    const candidates = [
      '/code/treeline',
      '/code/treeline/.claude/worktrees/cats',
    ];
    expect(longestPrefixMatch(candidates, '/code/treeline/.claude/worktrees/cats/sub')).toBe(
      '/code/treeline/.claude/worktrees/cats',
    );
  });
  it('returns the candidate when target equals it', () => {
    expect(longestPrefixMatch(['/x'], '/x')).toBe('/x');
  });
  it('returns null when nothing matches', () => {
    expect(longestPrefixMatch(['/code/foo'], '/code/bar')).toBeNull();
  });
  it('does NOT match a partial directory name (substring trap)', () => {
    expect(longestPrefixMatch(['/code/foo'], '/code/foobar')).toBeNull();
  });
});

describe('indexByWorktreePath', () => {
  it('drops processes that match no worktree', () => {
    const procs: DetectedProcess[] = [
      { pid: 1, kind: 'claude', cwd: '/code/wt-a/sub', idle: false },
      { pid: 2, kind: 'aider', cwd: '/elsewhere', idle: false },
    ];
    const idx = indexByWorktreePath(procs, ['/code/wt-a']);
    expect(Object.keys(idx)).toEqual(['/code/wt-a']);
    expect(idx['/code/wt-a']).toHaveLength(1);
  });
});

describe('parseLsofListen', () => {
  it('extracts pid and port from IPv4 and IPv6 LISTEN rows, skipping the header', () => {
    const out = parseLsofListen(
      [
        'COMMAND   PID USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME',
        'node    12345  dom   23u  IPv4 0x1234567890abcdef      0t0  TCP *:3000 (LISTEN)',
        'node    12345  dom   24u  IPv6 0x1234567890abcdef      0t0  TCP [::1]:5173 (LISTEN)',
        'rapportd  999  dom    5u  IPv4 0xdeadbeefdeadbeef      0t0  TCP 127.0.0.1:8080 (LISTEN)',
      ].join('\n'),
    );
    expect(out).toEqual([
      { pid: 12345, port: 3000 },
      { pid: 12345, port: 5173 },
      { pid: 999, port: 8080 },
    ]);
  });

  it('ignores rows without a numeric port or pid', () => {
    const out = parseLsofListen(
      ['', '   ', 'node  notapid  dom 23u IPv4 0x0 0t0 TCP *:abc (LISTEN)'].join('\n'),
    );
    expect(out).toEqual([]);
  });
});

describe('indexPortsByWorktreePath', () => {
  it('attributes ports by longest-prefix cwd, deduping and sorting ascending', () => {
    const listeners: ListenerWithCwd[] = [
      { pid: 1, port: 5173, cwd: '/code/wt-a/packages/web' },
      { pid: 2, port: 3000, cwd: '/code/wt-a' },
      { pid: 3, port: 3000, cwd: '/code/wt-a/server' }, // dup port, same worktree
      { pid: 4, port: 9229, cwd: '/code/wt-b' },
    ];
    const idx = indexPortsByWorktreePath(listeners, ['/code/wt-a', '/code/wt-b']);
    expect(idx['/code/wt-a']).toEqual([3000, 5173]);
    expect(idx['/code/wt-b']).toEqual([9229]);
  });

  it('drops listeners with no cwd or no matching worktree', () => {
    const listeners: ListenerWithCwd[] = [
      { pid: 1, port: 3000, cwd: null },
      { pid: 2, port: 4000, cwd: '/elsewhere' },
      { pid: 3, port: 5000, cwd: '/code/wt-a' },
    ];
    const idx = indexPortsByWorktreePath(listeners, ['/code/wt-a']);
    expect(idx).toEqual({ '/code/wt-a': [5000] });
  });
});

describe('ProcessMonitor.tick (idle tracking)', () => {
  it('marks a process idle once cputime has been static for ≥10s', async () => {
    const ticks: RawProcess[][] = [
      [{ pid: 100, kind: 'claude', cwd: '/code/wt-a', cputime: 12.0 }], // initial
      [{ pid: 100, kind: 'claude', cwd: '/code/wt-a', cputime: 12.0 }], // unchanged, but <10s
      [{ pid: 100, kind: 'claude', cwd: '/code/wt-a', cputime: 12.0 }], // unchanged, ≥10s → idle
      [{ pid: 100, kind: 'claude', cwd: '/code/wt-a', cputime: 13.5 }], // moved → not idle
    ];
    const realDateNow = Date.now;
    let now = 1_000_000;
    Date.now = () => now;
    try {
      const mon = new ProcessMonitor(
        2000,
        async () => ticks.shift() ?? [],
        async () => [],
      );
      mon.setWorktreePaths(['/code/wt-a']);
      const snaps: { procs: DetectedProcess[] }[] = [];
      mon.on('snapshot', (e: { procs: DetectedProcess[] }) => snaps.push(e));

      await mon.tick();
      now += 1_000;
      await mon.tick();
      now += 11_000; // total static dwell ≥10s
      await mon.tick();
      now += 2_000;
      await mon.tick();

      expect(snaps[0]?.procs[0]?.idle).toBe(false);
      expect(snaps[1]?.procs[0]?.idle).toBe(false);
      expect(snaps[2]?.procs[0]?.idle).toBe(true);
      expect(snaps[3]?.procs[0]?.idle).toBe(false);
    } finally {
      Date.now = realDateNow;
    }
  });

  it('drops history for pids that disappear', async () => {
    const ticks: RawProcess[][] = [
      [{ pid: 100, kind: 'claude', cwd: '/x', cputime: 1 }],
      [{ pid: 200, kind: 'claude', cwd: '/x', cputime: 1 }],
    ];
    const mon = new ProcessMonitor(
      2000,
      async () => ticks.shift() ?? [],
      async () => [],
    );
    mon.setWorktreePaths(['/x']);
    const snaps: { procs: DetectedProcess[] }[] = [];
    mon.on('snapshot', (e: { procs: DetectedProcess[] }) => snaps.push(e));

    await mon.tick();
    await mon.tick();
    expect(snaps[1]?.procs.map((p) => p.pid)).toEqual([200]);
  });

  it('emits portsByWorktreePath and isolates a port-scan failure', async () => {
    const mon = new ProcessMonitor(
      2000,
      async () => [{ pid: 100, kind: 'claude', cwd: '/code/wt-a', cputime: 1 }],
      async () => [{ pid: 100, port: 3000, cwd: '/code/wt-a' }],
    );
    mon.setWorktreePaths(['/code/wt-a']);
    const snaps: { portsByWorktreePath: Record<string, number[]> }[] = [];
    mon.on('snapshot', (e: { portsByWorktreePath: Record<string, number[]> }) =>
      snaps.push(e),
    );

    await mon.tick();
    expect(snaps[0]?.portsByWorktreePath).toEqual({ '/code/wt-a': [3000] });

    // A failing port scan must not drop the snapshot — ports just go empty.
    const mon2 = new ProcessMonitor(
      2000,
      async () => [{ pid: 100, kind: 'claude', cwd: '/code/wt-a', cputime: 1 }],
      async () => {
        throw new Error('lsof blew up');
      },
    );
    mon2.setWorktreePaths(['/code/wt-a']);
    const snaps2: { procs: DetectedProcess[]; portsByWorktreePath: Record<string, number[]> }[] =
      [];
    mon2.on(
      'snapshot',
      (e: { procs: DetectedProcess[]; portsByWorktreePath: Record<string, number[]> }) =>
        snaps2.push(e),
    );
    await mon2.tick();
    expect(snaps2[0]?.procs).toHaveLength(1);
    expect(snaps2[0]?.portsByWorktreePath).toEqual({});
  });
});
