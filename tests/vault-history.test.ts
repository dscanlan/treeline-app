import { describe, expect, it } from 'vitest';
import { createStore } from 'zustand/vanilla';
import { createVaultSlice, NOTE_HISTORY_MAX } from '@/store/vault-slice';
import type { VaultSlice } from '@/store/vault-slice';

const makeStore = () => createStore<VaultSlice>()(createVaultSlice);

describe('note-navigation history (breadcrumb trail)', () => {
  it('pushes link-departures in order, oldest first', () => {
    const store = makeStore();
    store.getState().pushNoteHistory('/vault/ingests.md');
    store.getState().pushNoteHistory('/vault/concepts/a.md');
    expect(store.getState().noteHistory).toEqual(['/vault/ingests.md', '/vault/concepts/a.md']);
  });

  it('truncateTo keeps entries below the landing index — browser-style back', () => {
    // ingests → a → b → current; back button lands on b (index 2), so the
    // trail becomes [ingests, a] and b is the open file, not a history entry.
    const store = makeStore();
    for (const p of ['/v/ingests.md', '/v/a.md', '/v/b.md']) store.getState().pushNoteHistory(p);
    store.getState().truncateNoteHistory(2);
    expect(store.getState().noteHistory).toEqual(['/v/ingests.md', '/v/a.md']);
  });

  it('a breadcrumb jump to the trail root empties the trail', () => {
    const store = makeStore();
    for (const p of ['/v/ingests.md', '/v/a.md', '/v/b.md']) store.getState().pushNoteHistory(p);
    store.getState().truncateNoteHistory(0);
    expect(store.getState().noteHistory).toEqual([]);
  });

  it('truncating past the end is a no-op (stale index from a race)', () => {
    const store = makeStore();
    store.getState().pushNoteHistory('/v/a.md');
    const before = store.getState().noteHistory;
    store.getState().truncateNoteHistory(5);
    expect(store.getState().noteHistory).toBe(before); // same reference — no state churn
  });

  it('clearNoteHistory empties the trail (fresh navigation / panel close)', () => {
    const store = makeStore();
    store.getState().pushNoteHistory('/v/a.md');
    store.getState().clearNoteHistory();
    expect(store.getState().noteHistory).toEqual([]);
  });

  it('clear on an already-empty trail does not churn state', () => {
    const store = makeStore();
    const before = store.getState().noteHistory;
    store.getState().clearNoteHistory();
    expect(store.getState().noteHistory).toBe(before);
  });

  it(`caps the trail at ${NOTE_HISTORY_MAX}, dropping the oldest`, () => {
    const store = makeStore();
    for (let i = 0; i < NOTE_HISTORY_MAX + 10; i++) {
      store.getState().pushNoteHistory(`/v/note-${i}.md`);
    }
    const trail = store.getState().noteHistory;
    expect(trail).toHaveLength(NOTE_HISTORY_MAX);
    expect(trail[0]).toBe('/v/note-10.md'); // oldest 10 dropped
    expect(trail[trail.length - 1]).toBe(`/v/note-${NOTE_HISTORY_MAX + 9}.md`);
  });
});
