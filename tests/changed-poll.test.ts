import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHANGED_POLL_MS, startChangedFilesPoll } from '@/changed-poll';

describe('startChangedFilesPoll', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('refreshes once immediately on start', () => {
    const refresh = vi.fn();
    startChangedFilesPoll('/wt', { refresh, isVisible: () => true });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith('/wt');
  });

  it('keeps refreshing on each interval while visible', () => {
    const refresh = vi.fn();
    startChangedFilesPoll('/wt', { refresh, isVisible: () => true, intervalMs: 1000 });
    expect(refresh).toHaveBeenCalledTimes(1); // immediate
    vi.advanceTimersByTime(3000);
    expect(refresh).toHaveBeenCalledTimes(4); // + three ticks
  });

  it('skips ticks while the window is hidden, resuming when visible again', () => {
    const refresh = vi.fn();
    let visible = true;
    startChangedFilesPoll('/wt', { refresh, isVisible: () => visible, intervalMs: 1000 });
    expect(refresh).toHaveBeenCalledTimes(1); // immediate

    visible = false;
    vi.advanceTimersByTime(3000); // three ticks, all skipped
    expect(refresh).toHaveBeenCalledTimes(1);

    visible = true;
    vi.advanceTimersByTime(2000); // two ticks fire
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it('stops polling after the cleanup function runs', () => {
    const refresh = vi.fn();
    const stop = startChangedFilesPoll('/wt', { refresh, isVisible: () => true, intervalMs: 1000 });
    vi.advanceTimersByTime(1000);
    expect(refresh).toHaveBeenCalledTimes(2);

    stop();
    vi.advanceTimersByTime(5000);
    expect(refresh).toHaveBeenCalledTimes(2); // no further calls
  });

  it('defaults to the documented cadence', () => {
    const refresh = vi.fn();
    startChangedFilesPoll('/wt', { refresh, isVisible: () => true });
    refresh.mockClear();
    vi.advanceTimersByTime(CHANGED_POLL_MS - 1);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
