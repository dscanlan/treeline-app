// Single source of truth for the embedded browser pane's guest <webview>
// WebContents and the scriptable operations an agent drives it with (via the
// CLI socket — see cli-handlers.ts `browser`).
//
// The guest is a real, network-capable browser rendering attacker-influenceable
// web content — unlike the read-only code viewer (`files.*`), which the
// architecture explicitly says is NOT a trust boundary. Scripting it therefore
// widens the app's trust surface, so two guards are deliberate:
//
//   1. ONLY main ever holds the guest handle. It's captured in
//      `hardenWebviews()`'s did-attach-webview; the renderer never gets a way to
//      run `executeJavaScript` against arbitrary pages with main-process reach.
//   2. `evalInBrowser` is gated to LOCAL origins (localhost/127.0.0.1/[::1]) —
//      the "open my dev server and verify it" use case. An agent can't script an
//      arbitrary remote site the user happened to navigate to. Screenshots are
//      read-only pixels of a page the user already opened, so they're allowed
//      everywhere.

import { writeFile } from 'node:fs/promises';
import type { WebContents } from 'electron';

// The pane is a single global panel today (one webview at a time), so a single
// reference suffices. If multi-pane lands (see the idea note), this becomes a
// Map<paneId, WebContents> and the ops take a target id.
let guest: WebContents | null = null;

/** Record the freshly-attached browser guest. Called from did-attach-webview. */
export function setBrowserGuest(wc: WebContents): void {
  guest = wc;
}

/** Forget the guest when its webview is torn down (pane closed / reloaded). */
export function clearBrowserGuest(wc: WebContents): void {
  if (guest === wc) guest = null;
}

function requireGuest(): WebContents {
  if (!guest || guest.isDestroyed()) {
    throw new Error('browser pane is not open');
  }
  return guest;
}

// IPv6 loopback shows up as `[::1]` in a URL's hostname; keep the bare form too
// for defensiveness.
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * Throw unless the guest's current page is on a local origin. Used to gate the
 * scripting verbs (eval, and Phase-2 click/fill) to dev servers.
 */
export function assertScriptableOrigin(wc: WebContents): void {
  let host: string;
  try {
    host = new URL(wc.getURL()).hostname;
  } catch {
    throw new Error('scripting blocked: page has no scriptable origin');
  }
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(`scripting blocked: non-local origin (${host || 'unknown'})`);
  }
}

/**
 * Evaluate `code` in the guest and resolve with its result. The result must be
 * structured-cloneable (executeJavaScript serialises it) to survive the trip
 * back over the CLI socket.
 */
export async function evalInBrowser(code: string): Promise<unknown> {
  if (typeof code !== 'string' || code.length === 0) {
    throw new Error('browser eval requires a non-empty <js> string');
  }
  const wc = requireGuest();
  assertScriptableOrigin(wc);
  // `true` runs the script as if triggered by a user gesture, matching a real
  // interaction (some page APIs require one).
  return wc.executeJavaScript(code, true);
}

/** Capture the guest as a PNG data URL. Allowed on any origin (read-only). */
export async function captureBrowser(): Promise<string> {
  const wc = requireGuest();
  const img = await wc.capturePage();
  return img.toDataURL();
}

/**
 * Capture the guest and write it to `path` (an absolute path the CLI resolved
 * against the caller's cwd). Returns the path written. Far more usable than a
 * multi-KB data URL on stdout when an agent wants the image as a file.
 */
export async function captureBrowserToFile(path: string): Promise<string> {
  const wc = requireGuest();
  const img = await wc.capturePage();
  await writeFile(path, img.toPNG());
  return path;
}

/**
 * Resolve once the guest is open and idle on `targetUrl`'s origin — i.e. the
 * page has finished loading. Backs `navigate --wait` so an agent's act-then-
 * verify loop doesn't race the page load.
 *
 * Polling (rather than one-shot load events) is deliberate: it handles the pane
 * opening fresh, re-navigation of an already-open pane, and same-origin
 * redirects (e.g. `/` → `/login`) uniformly. The initial delay lets the
 * renderer commit the new src and the webview flip into `isLoading` first, so a
 * same-origin re-nav isn't resolved against the old (still-idle) page.
 */
export function waitForGuestLoad(targetUrl: string, timeoutMs = 15000): Promise<void> {
  let target: URL;
  try {
    target = new URL(targetUrl);
  } catch {
    return Promise.reject(new Error(`invalid url: ${targetUrl}`));
  }
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const poll = () => {
      const wc = guest;
      if (wc && !wc.isDestroyed() && !wc.isLoading()) {
        try {
          const cur = new URL(wc.getURL());
          if (cur.protocol === target.protocol && cur.host === target.host) {
            resolve();
            return;
          }
        } catch {
          /* about:blank / no origin yet — keep waiting */
        }
      }
      if (Date.now() > deadline) {
        reject(new Error('timed out waiting for the browser pane to load'));
        return;
      }
      setTimeout(poll, 100);
    };
    // Give the navigation a beat to begin before the first check.
    setTimeout(poll, 150);
  });
}
