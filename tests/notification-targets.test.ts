import { describe, expect, it } from 'vitest';
import { resolveNotificationTargets, type PaneLocator } from '../src/main/notification-targets';

/** Build a PaneLocator from a map of pane id → cwd. */
function locator(panes: Record<string, string>): PaneLocator {
  return {
    has: (id) => id in panes,
    shellPids: () => Object.keys(panes).map((id) => ({ id, shellPid: 0 })),
    cwdOf: (id) => panes[id],
  };
}

describe('resolveNotificationTargets', () => {
  it('targets the exact pane when a live paneId is given', () => {
    const mgr = locator({ a: '/code/app', b: '/code/app' });
    expect(resolveNotificationTargets(mgr, { paneId: 'a', cwd: '/code/app' })).toEqual(['a']);
  });

  it('prefers paneId over cwd even when two tabs share the directory', () => {
    // The exact bug: two panes on the same cwd. paneId must pick just one.
    const mgr = locator({ a: '/code/app', b: '/code/app' });
    expect(resolveNotificationTargets(mgr, { paneId: 'b', cwd: '/code/app' })).toEqual(['b']);
  });

  it('does NOT fan out across multiple panes sharing a cwd when paneId is absent', () => {
    // The follow-up Claude notification that lost TREELINE_PANE_ID: cwd alone is
    // ambiguous, so light nothing (caller toasts) rather than the wrong tab.
    const mgr = locator({ a: '/code/app', b: '/code/app' });
    expect(resolveNotificationTargets(mgr, { cwd: '/code/app' })).toEqual([]);
  });

  it('does NOT fan out when paneId is stale (no longer a live pane)', () => {
    const mgr = locator({ a: '/code/app', b: '/code/app' });
    expect(resolveNotificationTargets(mgr, { paneId: 'gone', cwd: '/code/app' })).toEqual([]);
  });

  it('lights the single pane when a cwd resolves unambiguously', () => {
    const mgr = locator({ a: '/code/app', b: '/code/other' });
    expect(resolveNotificationTargets(mgr, { cwd: '/code/app' })).toEqual(['a']);
  });

  it('falls back to containment when no exact cwd match, if unique', () => {
    const mgr = locator({ a: '/code/app' });
    expect(resolveNotificationTargets(mgr, { cwd: '/code/app/src' })).toEqual(['a']);
  });

  it('returns [] for containment matches that are ambiguous', () => {
    const mgr = locator({ a: '/code/app', b: '/code/app/sub' });
    // cwd /code/app/sub: exact = [b], so it resolves to the single exact match.
    expect(resolveNotificationTargets(mgr, { cwd: '/code/app/sub' })).toEqual(['b']);
    // cwd /code with two descendants → containment matches both → ambiguous → [].
    const mgr2 = locator({ a: '/code/app', b: '/code/other' });
    expect(resolveNotificationTargets(mgr2, { cwd: '/code' })).toEqual([]);
  });

  it('returns [] when neither paneId nor cwd is usable', () => {
    const mgr = locator({ a: '/code/app' });
    expect(resolveNotificationTargets(mgr, {})).toEqual([]);
  });
});
