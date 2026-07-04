import { describe, expect, it } from 'vitest';
import { createStore } from 'zustand/vanilla';
import { createBrowserSlice, DEFAULT_BROWSER_URL } from '@/store/browser-slice';
import type { BrowserSlice } from '@/store/browser-slice';

const makeStore = () => createStore<BrowserSlice>()(createBrowserSlice);

describe('browser slice navigation commits', () => {
  it('re-committing the URL the store already holds is still observable (0.18.x refresh bug)', () => {
    // Repro of the field bug: commit URL X, let the guest wander (in-page nav
    // does NOT touch browserSrc), then commit X again — from a port chip,
    // address-bar re-submit, or CLI navigate. Before browserNavId existed the
    // second commit was a no-op store write, so the pane never re-navigated
    // and the only recovery was closing the pane to force a webview remount.
    const store = makeStore();
    const url = 'http://localhost:3000';

    store.getState().navigateBrowser(url);
    const afterFirst = store.getState();
    expect(afterFirst.browserSrc).toBe(url);

    store.getState().navigateBrowser(url);
    const afterSecond = store.getState();
    expect(afterSecond.browserSrc).toBe(url);
    expect(afterSecond.browserNavId).toBeGreaterThan(afterFirst.browserNavId);
  });

  it('openBrowserPanel(url) commits a navigation even when the URL is unchanged', () => {
    const store = makeStore();
    const url = 'http://localhost:5173';

    store.getState().openBrowserPanel(url);
    const first = store.getState().browserNavId;

    store.getState().openBrowserPanel(url);
    expect(store.getState().browserNavId).toBeGreaterThan(first);
    expect(store.getState().browserPanelOpen).toBe(true);
  });

  it('openBrowserPanel() with no URL only opens the pane — no navigation commit', () => {
    const store = makeStore();
    const before = store.getState().browserNavId;

    store.getState().openBrowserPanel();
    expect(store.getState().browserNavId).toBe(before);
    expect(store.getState().browserSrc).toBe(DEFAULT_BROWSER_URL);
    expect(store.getState().browserPanelOpen).toBe(true);
  });

  it('navigateBrowser clears a prior load error', () => {
    const store = makeStore();
    store.getState().setBrowserError('ERR_CONNECTION_REFUSED — http://localhost:3000');

    store.getState().navigateBrowser('http://localhost:3000');
    expect(store.getState().browserError).toBeNull();
  });
});
