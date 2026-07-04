import type { StateCreator } from 'zustand';

/** Clamp bounds for the resizable browser pane (px). */
export const BROWSER_PANEL_MIN_WIDTH = 360;
export const BROWSER_PANEL_MAX_WIDTH = 1400;
export const BROWSER_PANEL_DEFAULT_WIDTH = 600;

/** Where the pane points when first opened — the typical local dev server. */
export const DEFAULT_BROWSER_URL = 'http://localhost:3000';

/**
 * State for the embedded browser pane (BrowserPane). The pane hosts an Electron
 * <webview>; this slice holds the React-side view of it.
 *
 * Two URLs are tracked deliberately:
 * - `browserSrc` is the committed navigation target bound to the webview's
 *   `src`. It changes *only* on an explicit navigate/open, so in-page link
 *   clicks don't get clobbered by a re-render.
 * - `browserAddress` is the *live* location reported by the guest (link clicks,
 *   redirects, back/forward) and drives the address bar.
 */
export interface BrowserSlice {
  /** Whether the browser pane is visible in MainArea. */
  browserPanelOpen: boolean;
  /** Width of the browser pane in px (the terminal takes the remaining space). */
  browserPanelWidth: number;

  /** URL committed into the webview's `src`; only set on explicit navigation. */
  browserSrc: string;
  /**
   * Monotonic counter bumped on every explicit navigation commit. The guest may
   * have moved on (link clicks, redirects), leaving `browserSrc` already equal
   * to the *next* commit's URL — a plain string compare would make that commit
   * unobservable and the pane would never re-navigate. BrowserPane keys its
   * imperative `loadURL` on this instead, so committing the same URL twice
   * still navigates (and address-bar re-submit doubles as reload).
   */
  browserNavId: number;
  /** Live location reported by the guest — what the address bar shows. */
  browserAddress: string;

  browserLoading: boolean;
  browserError: string | null;
  browserCanGoBack: boolean;
  browserCanGoForward: boolean;
  /** Page title reported by the guest (header tooltip). */
  browserTitle: string | null;

  setBrowserPanelWidth: (w: number) => void;
  /** Open the pane; optionally commit `url` as the navigation target. */
  openBrowserPanel: (url?: string) => void;
  closeBrowserPanel: () => void;
  toggleBrowserPanel: () => void;

  /** Commit an already-normalized URL as the new navigation target. */
  navigateBrowser: (url: string) => void;
  setBrowserLoading: (loading: boolean) => void;
  setBrowserError: (error: string | null) => void;
  /** Mirror the guest's navigation state after a navigate/stop-loading event. */
  setBrowserNavState: (s: {
    address: string;
    canGoBack: boolean;
    canGoForward: boolean;
  }) => void;
  setBrowserTitle: (title: string | null) => void;
}

export const createBrowserSlice: StateCreator<BrowserSlice, [], [], BrowserSlice> = (set) => ({
  browserPanelOpen: false,
  browserPanelWidth: BROWSER_PANEL_DEFAULT_WIDTH,

  browserSrc: DEFAULT_BROWSER_URL,
  browserNavId: 0,
  browserAddress: DEFAULT_BROWSER_URL,
  browserLoading: false,
  browserError: null,
  browserCanGoBack: false,
  browserCanGoForward: false,
  browserTitle: null,

  setBrowserPanelWidth: (w) =>
    set({
      browserPanelWidth: Math.max(
        BROWSER_PANEL_MIN_WIDTH,
        Math.min(BROWSER_PANEL_MAX_WIDTH, w),
      ),
    }),

  openBrowserPanel: (url) =>
    set((s) =>
      url
        ? {
            browserPanelOpen: true,
            browserSrc: url,
            browserNavId: s.browserNavId + 1,
            browserAddress: url,
            browserError: null,
          }
        : { browserPanelOpen: true },
    ),

  closeBrowserPanel: () => set({ browserPanelOpen: false }),

  toggleBrowserPanel: () => set((s) => ({ browserPanelOpen: !s.browserPanelOpen })),

  navigateBrowser: (url) =>
    set((s) => ({
      browserSrc: url,
      browserNavId: s.browserNavId + 1,
      browserAddress: url,
      browserError: null,
    })),

  setBrowserLoading: (loading) => set({ browserLoading: loading }),

  setBrowserError: (error) => set({ browserError: error, browserLoading: false }),

  setBrowserNavState: ({ address, canGoBack, canGoForward }) =>
    set({
      browserAddress: address,
      browserCanGoBack: canGoBack,
      browserCanGoForward: canGoForward,
    }),

  setBrowserTitle: (title) => set({ browserTitle: title }),
});
