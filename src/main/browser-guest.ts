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

// Whether we've attached the CDP debugger to the CURRENT guest (Phase 2's
// snapshot/click/fill drive the page through `webContents.debugger`). Attach is
// lazy — only when a CDP verb is first used — and the flag is reset whenever the
// guest changes, so a reloaded/replaced pane re-attaches cleanly.
let cdpAttached = false;

/** Record the freshly-attached browser guest. Called from did-attach-webview. */
export function setBrowserGuest(wc: WebContents): void {
  guest = wc;
  cdpAttached = false;
}

/** Forget the guest when its webview is torn down (pane closed / reloaded). */
export function clearBrowserGuest(wc: WebContents): void {
  if (guest === wc) {
    guest = null;
    cdpAttached = false;
  }
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

// ----------------------------------------------------------------------------
// Phase 2 — structured input over the Chrome DevTools Protocol
//
// snapshot/query read the page (allowed on any origin, like screenshot);
// click/fill mutate it and so carry the same localhost-only `assertScriptableOrigin`
// guard as `eval`. Targeting is by CSS selector; the actual click is a synthetic
// `Input.dispatchMouseEvent` and typing is `Input.insertText` (robust across
// keyboard layouts), so interactions go through the real input pipeline rather
// than DOM `.click()`.
// ----------------------------------------------------------------------------

/** Lazily attach the CDP debugger to the current guest, then send `method`. */
async function cdp(wc: WebContents, method: string, params?: object): Promise<unknown> {
  if (!cdpAttached) {
    // `attach` throws if DevTools (or another client) already holds the guest.
    try {
      wc.debugger.attach('1.3');
    } catch (e) {
      throw new Error(
        `could not attach the browser debugger (is DevTools open on the pane?): ${(e as Error).message}`,
      );
    }
    cdpAttached = true;
  }
  return wc.debugger.sendCommand(method, params);
}

interface ResolvedTarget {
  x: number;
  y: number;
  tag: string;
  text: string;
  visible: boolean;
  count: number;
}

/**
 * Resolve a CSS selector against the guest's DOM: scroll the first match into
 * view and return its viewport-centre coordinates (what `Input.dispatchMouseEvent`
 * wants) plus a small descriptor. Returns null when nothing matches. Geometry is
 * read via `Runtime.evaluate` (getBoundingClientRect gives viewport-relative
 * coords directly, sidestepping box-model/scroll math); the *interaction* still
 * goes through synthetic CDP input.
 */
async function resolveTarget(wc: WebContents, selector: string): Promise<ResolvedTarget | null> {
  const expr = `(() => {
    const sel = ${JSON.stringify(selector)};
    const all = document.querySelectorAll(sel);
    const el = all[0];
    if (!el) return null;
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const r = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return {
      x: r.left + r.width / 2,
      y: r.top + r.height / 2,
      tag: el.tagName.toLowerCase(),
      text: (el.innerText || el.value || '').trim().slice(0, 120),
      visible: r.width > 0 && r.height > 0 && style.visibility !== 'hidden' && style.display !== 'none',
      count: all.length,
    };
  })()`;
  const res = (await cdp(wc, 'Runtime.evaluate', {
    expression: expr,
    returnByValue: true,
  })) as { result?: { value?: ResolvedTarget | null } };
  return res.result?.value ?? null;
}

/**
 * Compact, agent-friendly accessibility snapshot of the guest. Walks the CDP AX
 * tree and emits `role "name"` lines (with a value for text fields), indented by
 * depth — ignored/unnamed generic nodes are pruned to keep the payload small.
 * Read-only, so allowed on any origin.
 */
export async function snapshotBrowser(): Promise<string> {
  const wc = requireGuest();
  await cdp(wc, 'Accessibility.enable');
  const { nodes } = (await cdp(wc, 'Accessibility.getFullAXTree')) as { nodes: AxNode[] };

  const byId = new Map<string, AxNode>();
  for (const n of nodes) byId.set(n.nodeId, n);
  // The root is the one node nobody lists as a child / whose parent is absent.
  const root = nodes.find((n) => !n.parentId || !byId.has(n.parentId)) ?? nodes[0];
  if (!root) return '';

  const lines: string[] = [];
  const MAX_LINES = 2000;
  const walk = (node: AxNode | undefined, depth: number): void => {
    if (!node || lines.length >= MAX_LINES) return;
    const role = node.role?.value ?? '';
    const name = (node.name?.value ?? '').toString().trim();
    const value = (node.value?.value ?? '').toString().trim();
    // Keep a node only if it carries signal: a meaningful role with a name, or
    // an interactive/structural role worth showing even unnamed.
    const interactive = INTERACTIVE_ROLES.has(role);
    const keep = !node.ignored && role && role !== 'none' && role !== 'generic' && (name || interactive);
    let childDepth = depth;
    if (keep) {
      const label = name ? ` "${name.slice(0, 120)}"` : '';
      const val = value ? ` (value: "${value.slice(0, 80)}")` : '';
      lines.push(`${'  '.repeat(depth)}${role}${label}${val}`);
      childDepth = depth + 1;
    }
    for (const id of node.childIds ?? []) walk(byId.get(id), childDepth);
  };
  walk(root, 0);
  if (lines.length >= MAX_LINES) lines.push('… (snapshot truncated)');
  return lines.join('\n');
}

interface AxNode {
  nodeId: string;
  parentId?: string;
  childIds?: string[];
  ignored?: boolean;
  role?: { value?: string };
  name?: { value?: string };
  value?: { value?: string | number };
}

const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'textbox',
  'searchbox',
  'checkbox',
  'radio',
  'combobox',
  'menuitem',
  'tab',
  'switch',
  'slider',
  'option',
]);

/**
 * Inspect a selector without acting on it: returns a compact descriptor of the
 * first match (and how many matched) or null when nothing matches. Lets an agent
 * confirm/disambiguate a selector before click/fill. Read-only → any origin.
 */
export async function queryBrowserElement(selector: string): Promise<ResolvedTarget | null> {
  if (typeof selector !== 'string' || selector.length === 0) {
    throw new Error('browser query requires a non-empty <selector>');
  }
  const wc = requireGuest();
  return resolveTarget(wc, selector);
}

/** Dispatch a synthetic left click at (x, y) in the guest viewport. */
async function dispatchClick(wc: WebContents, x: number, y: number): Promise<void> {
  const base = { x, y, button: 'left' as const };
  await cdp(wc, 'Input.dispatchMouseEvent', { type: 'mouseMoved', ...base });
  await cdp(wc, 'Input.dispatchMouseEvent', { type: 'mousePressed', clickCount: 1, buttons: 1, ...base });
  await cdp(wc, 'Input.dispatchMouseEvent', { type: 'mouseReleased', clickCount: 1, buttons: 1, ...base });
}

/**
 * Click the element matched by `selector` with a synthetic mouse event at its
 * centre. Localhost-only (it mutates the page). Throws if the selector matches
 * nothing.
 */
export async function clickInBrowser(selector: string): Promise<{ clicked: string }> {
  if (typeof selector !== 'string' || selector.length === 0) {
    throw new Error('browser click requires a non-empty <selector>');
  }
  const wc = requireGuest();
  assertScriptableOrigin(wc);
  const target = await resolveTarget(wc, selector);
  if (!target) throw new Error(`no element matches selector: ${selector}`);
  await dispatchClick(wc, target.x, target.y);
  return { clicked: selector };
}

/**
 * Fill the element matched by `selector` with `text`: click it to focus (real
 * input pipeline), select any existing content, then `Input.insertText`.
 * Localhost-only. Throws if the selector matches nothing.
 */
export async function fillInBrowser(selector: string, text: string): Promise<{ filled: string }> {
  if (typeof selector !== 'string' || selector.length === 0) {
    throw new Error('browser fill requires a non-empty <selector>');
  }
  if (typeof text !== 'string') {
    throw new Error('browser fill requires a <text> string');
  }
  const wc = requireGuest();
  assertScriptableOrigin(wc);
  const target = await resolveTarget(wc, selector);
  if (!target) throw new Error(`no element matches selector: ${selector}`);
  await dispatchClick(wc, target.x, target.y);
  // Select existing content so insertText replaces rather than appends. Done on
  // the now-focused element; insertText itself is the synthetic input.
  await cdp(wc, 'Runtime.evaluate', {
    expression: `(() => {
      const el = document.activeElement;
      if (el && typeof el.select === 'function') el.select();
      else document.execCommand && document.execCommand('selectAll', false, null);
    })()`,
  });
  await cdp(wc, 'Input.insertText', { text });
  return { filled: selector };
}
