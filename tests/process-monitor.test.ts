import { describe, expect, it } from 'vitest';
import {
  commandToKind,
  indexByWorktreePath,
  longestPrefixMatch,
  parseCputime,
  parsePsProcesses,
  ProcessMonitor,
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
      const mon = new ProcessMonitor(2000, async () => ticks.shift() ?? []);
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
    const mon = new ProcessMonitor(2000, async () => ticks.shift() ?? []);
    mon.setWorktreePaths(['/x']);
    const snaps: { procs: DetectedProcess[] }[] = [];
    mon.on('snapshot', (e: { procs: DetectedProcess[] }) => snaps.push(e));

    await mon.tick();
    await mon.tick();
    expect(snaps[1]?.procs.map((p) => p.pid)).toEqual([200]);
  });
});
