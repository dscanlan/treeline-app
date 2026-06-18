import { describe, expect, it } from 'vitest';
import {
  WorktreeDriftMonitor,
  type WorktreeDriftEvent,
} from '../src/main/worktree-drift-monitor';

/** Build a monitor over a fixed worktree set, collecting emitted drifts. */
function setup(paths: string[]) {
  const m = new WorktreeDriftMonitor();
  m.setWorktreePaths(paths);
  const events: WorktreeDriftEvent[] = [];
  m.on('worktree-drift', (e) => events.push(e as WorktreeDriftEvent));
  return { m, events };
}

describe('WorktreeDriftMonitor', () => {
  it('records the home worktree on the first cwd without emitting', () => {
    const { m, events } = setup(['/r/main', '/r/feat']);
    m.onCwd('p1', '/r/main');
    expect(events).toEqual([]);
  });

  it('emits once when the cwd moves into a different worktree', () => {
    const { m, events } = setup(['/r/main', '/r/feat']);
    m.onCwd('p1', '/r/main'); // home
    m.onCwd('p1', '/r/feat/src'); // drifted (sub-dir resolves to /r/feat)
    expect(events).toEqual([
      { ptyId: 'p1', fromWorktree: '/r/main', toWorktree: '/r/feat' },
    ]);
  });

  it('dedupes repeated ticks at the same drifted worktree', () => {
    const { m, events } = setup(['/r/main', '/r/feat']);
    m.onCwd('p1', '/r/main');
    m.onCwd('p1', '/r/feat');
    m.onCwd('p1', '/r/feat/src');
    m.onCwd('p1', '/r/feat');
    expect(events).toHaveLength(1);
  });

  it('does not emit for cd within the same (home) worktree', () => {
    const { m, events } = setup(['/r/main']);
    m.onCwd('p1', '/r/main');
    m.onCwd('p1', '/r/main/src/deep');
    expect(events).toEqual([]);
  });

  it('does not emit when the cwd is outside any known worktree', () => {
    const { m, events } = setup(['/r/main', '/r/feat']);
    m.onCwd('p1', '/r/main');
    m.onCwd('p1', '/tmp/elsewhere');
    expect(events).toEqual([]);
  });

  it('handles a home outside any worktree (scratch → worktree still drifts)', () => {
    const { m, events } = setup(['/r/feat']);
    m.onCwd('p1', '/Users/me'); // home = null
    m.onCwd('p1', '/r/feat');
    expect(events).toEqual([
      { ptyId: 'p1', fromWorktree: null, toWorktree: '/r/feat' },
    ]);
  });

  it('does not match a sibling worktree by accidental prefix (feat vs feature)', () => {
    const { m, events } = setup(['/r/feat']);
    m.onCwd('p1', '/r/feat'); // home
    m.onCwd('p1', '/r/feature/src'); // not under /r/feat
    expect(events).toEqual([]);
  });

  it('tracks PTYs independently', () => {
    const { m, events } = setup(['/r/main', '/r/feat']);
    m.onCwd('p1', '/r/main');
    m.onCwd('p2', '/r/feat');
    m.onCwd('p1', '/r/feat'); // p1 drifts
    m.onCwd('p2', '/r/main'); // p2 drifts
    expect(events).toEqual([
      { ptyId: 'p1', fromWorktree: '/r/main', toWorktree: '/r/feat' },
      { ptyId: 'p2', fromWorktree: '/r/feat', toWorktree: '/r/main' },
    ]);
  });

  it('release() resets per-PTY state so a new spawn re-establishes home', () => {
    const { m, events } = setup(['/r/main', '/r/feat']);
    m.onCwd('p1', '/r/main');
    m.onCwd('p1', '/r/feat');
    expect(events).toHaveLength(1);
    m.release('p1');
    // Reused id: first cwd is home again, no drift.
    m.onCwd('p1', '/r/feat');
    expect(events).toHaveLength(1);
  });

  it('ignores empty ptyId or cwd', () => {
    const { m, events } = setup(['/r/feat']);
    m.onCwd('', '/r/feat');
    m.onCwd('p1', '');
    expect(events).toEqual([]);
  });
});
