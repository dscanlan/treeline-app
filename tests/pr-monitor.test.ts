import { afterEach, describe, expect, it } from 'vitest';
import { PrMonitor } from '../src/main/pr-monitor';
import type { PrInfo, PrSnapshot } from '../src/shared/types';

const openPr = (n: number): PrInfo => ({
  number: n,
  state: 'open',
  url: `https://x/pull/${n}`,
  checks: 'passing',
});

/** Let all fire-and-forget refreshes (setRepoPaths/tick) settle and emit. */
const flush = () => new Promise((r) => setTimeout(r, 0));

let monitors: PrMonitor[] = [];

/** Build a monitor with an always-available probe and a controllable fetch. */
function makeMonitor(
  fetch: (repoPath: string) => Promise<Record<string, PrInfo>>,
  probe: () => Promise<boolean> = async () => true,
) {
  const mon = new PrMonitor(60_000, fetch, probe);
  monitors.push(mon);
  const updates: PrSnapshot[] = [];
  mon.on('update', (s: PrSnapshot) => updates.push(s));
  return { mon, updates };
}

afterEach(() => {
  // start() sets a 60s interval; stop so the timer doesn't keep the loop alive.
  for (const m of monitors) m.stop();
  monitors = [];
});

describe('PrMonitor', () => {
  it('emits an update for each tracked repo on first refresh', async () => {
    const { mon, updates } = makeMonitor(async (repo) => ({ main: openPr(repo === '/a' ? 1 : 2) }));
    await mon.start();
    mon.setRepoPaths(['/a', '/b']); // auto-refreshes both new repos
    await flush();

    expect(updates.map((u) => u.repoPath).sort()).toEqual(['/a', '/b']);
    expect(updates.find((u) => u.repoPath === '/a')?.prByBranch['main']?.number).toBe(1);
  });

  it('emits only when a repo’s PR set changes', async () => {
    let branch: Record<string, PrInfo> = { main: openPr(1) };
    const { mon, updates } = makeMonitor(async () => branch);
    await mon.start();
    mon.setRepoPaths(['/a']);
    await flush();
    const countAfterFirst = updates.length;
    expect(countAfterFirst).toBe(1);

    await mon.tick(); // unchanged → no new emit
    await flush();
    expect(updates.length).toBe(countAfterFirst);

    branch = { main: openPr(2) }; // changed
    await mon.tick();
    await flush();
    expect(updates.length).toBe(countAfterFirst + 1);
    expect(updates.at(-1)?.prByBranch['main']?.number).toBe(2);
  });

  it('survives a throwing fetch without emitting', async () => {
    const { mon, updates } = makeMonitor(async () => {
      throw new Error('gh exploded');
    });
    await mon.start();
    mon.setRepoPaths(['/a']);
    await flush();
    await mon.tick();
    await flush();
    expect(updates).toHaveLength(0);
  });

  it('stays dormant when gh is unavailable', async () => {
    const { mon, updates } = makeMonitor(async () => ({ main: openPr(1) }), async () => false);
    await mon.start();
    mon.setRepoPaths(['/a']);
    await flush();
    await mon.tick();
    await flush();
    expect(updates).toHaveLength(0);
  });

  it('drops repos no longer tracked', async () => {
    const { mon, updates } = makeMonitor(async () => ({ main: openPr(1) }));
    await mon.start();
    mon.setRepoPaths(['/a', '/b']);
    await flush();
    updates.length = 0;

    mon.setRepoPaths(['/a']); // /b removed
    await mon.tick();
    await flush();
    expect(updates.every((u) => u.repoPath === '/a')).toBe(true);
  });
});
