import { describe, expect, it } from 'vitest';
import { ProcessError, run } from '../src/main/util/exec';

describe('run', () => {
  it('returns stdout with timedOut=false on success', async () => {
    const { stdout, timedOut } = await run('printf', ['hello']);
    expect(stdout).toBe('hello');
    expect(timedOut).toBe(false);
  });

  it('flags timedOut (not a clean empty result) when the process exceeds the timeout', async () => {
    // `sleep 5` can't finish in 100ms, so execFile kills it. With throwOnError
    // off we must be able to tell this apart from a successful empty run.
    const res = await run('sleep', ['5'], { timeoutMs: 100, throwOnError: false });
    expect(res.timedOut).toBe(true);
  });

  it('throws a ProcessError describing the timeout when throwOnError is on', async () => {
    await expect(run('sleep', ['5'], { timeoutMs: 100 })).rejects.toBeInstanceOf(
      ProcessError,
    );
  });

  it('reports timedOut=false for an ordinary non-zero exit', async () => {
    const res = await run('sh', ['-c', 'exit 3'], { throwOnError: false });
    expect(res.timedOut).toBe(false);
  });
});
