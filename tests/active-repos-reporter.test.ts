import { describe, expect, it, vi } from 'vitest';
import { createActiveReposReporter } from '../src/shared/active-repos-reporter';

describe('createActiveReposReporter', () => {
  it('sends the first report even when nothing is active', () => {
    // Regression: an empty first report was once swallowed by a '' sentinel,
    // so main never learned the sidebar was idle and kept polling every repo
    // at full cadence — the exact load the throttle exists to remove.
    const send = vi.fn();
    const report = createActiveReposReporter(send);
    report([]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith([]);
  });

  it('re-sends only when the set changes', () => {
    const send = vi.fn();
    const report = createActiveReposReporter(send);
    report([]);
    report([]);
    expect(send).toHaveBeenCalledTimes(1);
    report(['/a']);
    report(['/a']);
    expect(send).toHaveBeenCalledTimes(2);
    report(['/a', '/b']);
    expect(send).toHaveBeenCalledTimes(3);
    report([]);
    expect(send).toHaveBeenCalledTimes(4);
    expect(send).toHaveBeenLastCalledWith([]);
  });
});
