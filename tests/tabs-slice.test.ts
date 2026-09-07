import { describe, expect, it } from 'vitest';
import { createStore } from 'zustand/vanilla';
import { createTabsSlice, type TabsSlice } from '@/store/tabs-slice';

const makeStore = () => createStore<TabsSlice>()(createTabsSlice);

describe('terminal tab names', () => {
  it('renames one tab without changing its terminal tree or identity', () => {
    const store = makeStore();
    const firstId = store.getState().addTab({ ptyId: 'pty-a', cwd: '/repo/alpha' });
    const secondId = store.getState().addTab({ ptyId: 'pty-b', cwd: '/repo/beta' });
    const originalRoot = store.getState().tabs[0].root;

    store.getState().renameTab(firstId, '  API migration  ');

    const [first, second] = store.getState().tabs;
    expect(first).toMatchObject({ id: firstId, cwd: '/repo/alpha', title: 'API migration' });
    expect(first.root).toBe(originalRoot);
    expect(second).toMatchObject({ id: secondId, title: 'beta' });
  });

  it('ignores an empty name and an unknown tab', () => {
    const store = makeStore();
    const id = store.getState().addTab({ ptyId: 'pty-a', cwd: '/repo/alpha' });

    store.getState().renameTab(id, '   ');
    store.getState().renameTab('missing', 'Other');

    expect(store.getState().tabs).toHaveLength(1);
    expect(store.getState().tabs[0].title).toBe('alpha');
  });
});
