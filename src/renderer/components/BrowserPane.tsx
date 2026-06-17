import { useEffect, useRef, useState } from 'react';
import type { WebviewTag } from 'electron';
import { useShallow } from 'zustand/react/shallow';
import { normalizeBrowserUrl } from '@shared/browser-url';
import { useStore } from '../store';

// The webview's DOM events carry Electron-specific fields. We only type the few
// we read, rather than depend on Electron's ambient event namespace.
type WebviewFailLoadEvent = Event & {
  errorCode: number;
  errorDescription: string;
  validatedURL: string;
  isMainFrame: boolean;
};
type WebviewTitleEvent = Event & { title: string };

/**
 * The embedded browser pane beside the terminal. Hosts an Electron <webview>
 * pointed at a dev server (or any typed URL) so you can view — and an agent can
 * later script (see follow-up idea) — the running app without leaving treeline.
 *
 * Navigation is split: `browserSrc` is bound to the webview's `src` and only
 * changes on an explicit address-bar submit; back/forward/reload are driven
 * imperatively through the element ref so in-page navigation isn't clobbered.
 */
export function BrowserPane() {
  const s = useStore(
    useShallow((st) => ({
      browserSrc: st.browserSrc,
      browserAddress: st.browserAddress,
      browserLoading: st.browserLoading,
      browserError: st.browserError,
      browserCanGoBack: st.browserCanGoBack,
      browserCanGoForward: st.browserCanGoForward,
      browserTitle: st.browserTitle,
    })),
  );

  const webviewRef = useRef<WebviewTag | null>(null);
  // The address field is a local draft seeded from the live location so typing
  // doesn't fight the store; navigation events re-sync it.
  const [input, setInput] = useState(s.browserAddress);
  useEffect(() => setInput(s.browserAddress), [s.browserAddress]);

  // Wire the webview's lifecycle events into the store. Attached once; handlers
  // pull the latest setters from the store so there are no stale closures.
  useEffect(() => {
    const el = webviewRef.current;
    if (!el) return;

    const syncNav = () => {
      try {
        useStore.getState().setBrowserNavState({
          address: el.getURL(),
          canGoBack: el.canGoBack(),
          canGoForward: el.canGoForward(),
        });
      } catch {
        /* element not ready yet */
      }
    };

    const onStart = () => {
      const st = useStore.getState();
      st.setBrowserLoading(true);
      st.setBrowserError(null);
    };
    const onStop = () => {
      useStore.getState().setBrowserLoading(false);
      syncNav();
    };
    const onNavigate = () => syncNav();
    const onTitle = (e: Event) => {
      useStore.getState().setBrowserTitle((e as WebviewTitleEvent).title);
    };
    const onFail = (e: Event) => {
      const ev = e as WebviewFailLoadEvent;
      // -3 = ERR_ABORTED (e.g. the user navigated away mid-load). Ignore that
      // and sub-frame failures; only surface a real main-frame error.
      if (!ev.isMainFrame || ev.errorCode === -3) return;
      useStore
        .getState()
        .setBrowserError(`${ev.errorDescription || 'Failed to load'} — ${ev.validatedURL}`);
    };

    el.addEventListener('did-start-loading', onStart);
    el.addEventListener('did-stop-loading', onStop);
    el.addEventListener('did-navigate', onNavigate);
    el.addEventListener('did-navigate-in-page', onNavigate);
    el.addEventListener('page-title-updated', onTitle);
    el.addEventListener('did-fail-load', onFail);

    return () => {
      el.removeEventListener('did-start-loading', onStart);
      el.removeEventListener('did-stop-loading', onStop);
      el.removeEventListener('did-navigate', onNavigate);
      el.removeEventListener('did-navigate-in-page', onNavigate);
      el.removeEventListener('page-title-updated', onTitle);
      el.removeEventListener('did-fail-load', onFail);
    };
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const url = normalizeBrowserUrl(input);
    if (url) useStore.getState().navigateBrowser(url);
  };

  const goBack = () => webviewRef.current?.goBack();
  const goForward = () => webviewRef.current?.goForward();
  const reload = () => webviewRef.current?.reload();

  return (
    <section className="flex h-full min-w-0 flex-col bg-treeline-surface">
      <header className="flex shrink-0 items-center gap-1 border-b border-treeline-highlight px-2 py-1.5">
        <NavButton label="Back" symbol="‹" onClick={goBack} disabled={!s.browserCanGoBack} />
        <NavButton
          label="Forward"
          symbol="›"
          onClick={goForward}
          disabled={!s.browserCanGoForward}
        />
        <NavButton
          label={s.browserLoading ? 'Stop loading' : 'Reload'}
          symbol={s.browserLoading ? '×' : '⟳'}
          onClick={reload}
        />

        <form onSubmit={submit} className="min-w-0 flex-1">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onFocus={(e) => e.target.select()}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            placeholder="localhost:3000"
            title={s.browserTitle ?? s.browserAddress}
            className="w-full truncate rounded border border-treeline-highlight bg-treeline-surface px-2 py-0.5 text-xs text-treeline-text outline-none focus:border-treeline-cyan/60"
          />
        </form>

        <button
          type="button"
          onClick={() => useStore.getState().closeBrowserPanel()}
          title="Close browser pane"
          aria-label="Close browser pane"
          className="shrink-0 rounded px-1 text-treeline-dim hover:bg-treeline-highlight hover:text-treeline-red"
        >
          ×
        </button>
      </header>

      {s.browserError && (
        <div className="shrink-0 border-b border-treeline-highlight bg-treeline-red/10 px-3 py-1 text-xs text-treeline-red">
          {s.browserError}
        </div>
      )}

      <div className="relative min-h-0 flex-1 overflow-hidden bg-white">
        <webview
          ref={webviewRef}
          src={s.browserSrc}
          // `partition` isn't a standard DOM attribute (it's Electron's), so the
          // react plugin flags it; it gives the guest its own isolated session.
          // eslint-disable-next-line react/no-unknown-property
          partition="persist:treeline-browser"
          className="h-full w-full"
        />
        {s.browserLoading && (
          <div className="pointer-events-none absolute left-0 right-0 top-0 h-0.5 overflow-hidden">
            <div className="h-full w-1/3 animate-pulse bg-treeline-cyan" />
          </div>
        )}
      </div>
    </section>
  );
}

function NavButton({
  label,
  symbol,
  onClick,
  disabled,
}: {
  label: string;
  symbol: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="shrink-0 rounded px-1.5 py-0.5 text-sm leading-none text-treeline-dim hover:bg-treeline-highlight hover:text-treeline-text disabled:opacity-30 disabled:hover:bg-transparent"
    >
      {symbol}
    </button>
  );
}
