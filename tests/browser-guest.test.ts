import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WebContents } from 'electron';
import {
  setBrowserGuest,
  clearBrowserGuest,
  assertScriptableOrigin,
  evalInBrowser,
  captureBrowser,
  captureBrowserToFile,
  waitForGuestLoad,
  snapshotBrowser,
  queryBrowserElement,
  clickInBrowser,
  fillInBrowser,
} from '../src/main/browser-guest';

interface FakeOpts {
  /** Value resolved for Runtime.evaluate (the selector descriptor for click/fill/query). */
  target?: unknown;
  /** Nodes returned by Accessibility.getFullAXTree. */
  axNodes?: unknown[];
}

type FakeGuest = WebContents & { sent: { method: string; params?: object }[] };

/**
 * A minimal stand-in for the guest <webview> WebContents. Only the methods
 * browser-guest touches are implemented; the `electron` import is type-only so
 * these tests run under vitest without an Electron runtime. The `debugger` mock
 * records CDP traffic and routes by method so the Phase-2 ops can be asserted.
 */
function fakeGuest(url: string, opts: FakeOpts = {}): FakeGuest {
  const sent: { method: string; params?: object }[] = [];
  return {
    isDestroyed: () => false,
    isLoading: () => false,
    getURL: () => url,
    executeJavaScript: vi.fn(async (code: string) => `ran:${code}`),
    capturePage: vi.fn(async () => ({
      toDataURL: () => 'data:image/png;base64,ZZ',
      toPNG: () => Buffer.from('PNGDATA'),
    })),
    debugger: {
      attach: vi.fn(),
      sendCommand: vi.fn(async (method: string, params?: object) => {
        sent.push({ method, params });
        if (method === 'Runtime.evaluate') return { result: { value: opts.target ?? null } };
        if (method === 'Accessibility.getFullAXTree') return { nodes: opts.axNodes ?? [] };
        return {};
      }),
    },
    sent,
  } as unknown as FakeGuest;
}

describe('assertScriptableOrigin', () => {
  it('allows local origins', () => {
    for (const url of ['http://localhost:3000', 'http://127.0.0.1:5173', 'http://[::1]:8080/x']) {
      expect(() => assertScriptableOrigin(fakeGuest(url))).not.toThrow();
    }
  });

  it('rejects non-local origins', () => {
    expect(() => assertScriptableOrigin(fakeGuest('https://example.com'))).toThrow(/non-local/);
  });

  it('rejects a file:// page (viewable in the pane, but never scriptable)', () => {
    // file:// is navigable (normalizeBrowserUrl) so local HTML can be opened,
    // but it has no local host → eval/click/fill must stay blocked.
    expect(() => assertScriptableOrigin(fakeGuest('file:///etc/passwd'))).toThrow(/non-local/);
  });

  it('rejects a page with no parseable origin', () => {
    expect(() => assertScriptableOrigin(fakeGuest('about:blank'))).toThrow(/scripting blocked/);
  });
});

describe('evalInBrowser', () => {
  it('throws when no browser pane is open', async () => {
    clearBrowserGuest(fakeGuest('')); // ensure no stale guest from another test
    // Nothing set → requireGuest throws.
    await expect(evalInBrowser('1+1')).rejects.toThrow(/browser pane is not open/);
  });

  it('runs the script against a local guest and returns its result', async () => {
    const guest = fakeGuest('http://localhost:3000');
    setBrowserGuest(guest);
    await expect(evalInBrowser('document.title')).resolves.toBe('ran:document.title');
    expect(guest.executeJavaScript).toHaveBeenCalledWith('document.title', true);
    clearBrowserGuest(guest);
  });

  it('rejects empty code', async () => {
    setBrowserGuest(fakeGuest('http://localhost:3000'));
    await expect(evalInBrowser('')).rejects.toThrow(/non-empty/);
  });

  it('refuses to script a non-local origin', async () => {
    const guest = fakeGuest('https://example.com');
    setBrowserGuest(guest);
    await expect(evalInBrowser('alert(1)')).rejects.toThrow(/non-local/);
    expect(guest.executeJavaScript).not.toHaveBeenCalled();
    clearBrowserGuest(guest);
  });
});

describe('captureBrowser', () => {
  it('returns the guest capture as a data URL (any origin)', async () => {
    const guest = fakeGuest('https://example.com');
    setBrowserGuest(guest);
    await expect(captureBrowser()).resolves.toBe('data:image/png;base64,ZZ');
    clearBrowserGuest(guest);
  });

  it('throws when no pane is open', async () => {
    const guest = fakeGuest('http://localhost:3000');
    setBrowserGuest(guest);
    clearBrowserGuest(guest);
    await expect(captureBrowser()).rejects.toThrow(/browser pane is not open/);
  });
});

describe('captureBrowserToFile', () => {
  it('writes the PNG to the given path and returns it', async () => {
    const guest = fakeGuest('http://localhost:3000');
    setBrowserGuest(guest);
    const dir = mkdtempSync(join(tmpdir(), 'tl-shot-'));
    const out = join(dir, 'shot.png');
    await expect(captureBrowserToFile(out)).resolves.toBe(out);
    expect(readFileSync(out).toString()).toBe('PNGDATA');
    clearBrowserGuest(guest);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('waitForGuestLoad', () => {
  it('resolves once the guest is idle on the target origin', async () => {
    const guest = fakeGuest('http://localhost:5174/login'); // redirected path, same origin
    setBrowserGuest(guest);
    await expect(waitForGuestLoad('http://localhost:5174', 2000)).resolves.toBeUndefined();
    clearBrowserGuest(guest);
  });

  it('rejects on timeout when the pane never opens', async () => {
    const guest = fakeGuest('');
    setBrowserGuest(guest);
    clearBrowserGuest(guest); // no guest present
    await expect(waitForGuestLoad('http://localhost:3000', 200)).rejects.toThrow(/timed out/);
  });

  it('rejects an invalid url', async () => {
    await expect(waitForGuestLoad('http://[bad')).rejects.toThrow(/invalid url/);
  });
});

const TARGET = { x: 50, y: 20, tag: 'button', text: 'Save', visible: true, count: 1 };

describe('snapshotBrowser', () => {
  it('renders a compact, indented role/name tree and prunes generic nodes', async () => {
    const guest = fakeGuest('https://example.com', {
      axNodes: [
        { nodeId: '1', role: { value: 'WebArea' }, name: { value: 'Demo' }, childIds: ['2', '3'] },
        // generic, unnamed → pruned, but its child still shows (re-parented in indent)
        { nodeId: '2', parentId: '1', role: { value: 'generic' }, childIds: ['4'] },
        { nodeId: '3', parentId: '1', role: { value: 'button' }, name: { value: 'Save' } },
        { nodeId: '4', parentId: '2', role: { value: 'textbox' }, name: { value: 'Email' }, value: { value: 'a@b' } },
      ],
    });
    setBrowserGuest(guest);
    const snap = await snapshotBrowser();
    clearBrowserGuest(guest);
    expect(snap).toContain('WebArea "Demo"');
    expect(snap).toContain('button "Save"');
    expect(snap).toContain('textbox "Email" (value: "a@b")');
    expect(snap).not.toContain('generic');
  });

  it('is allowed on a non-local origin (read-only)', async () => {
    const guest = fakeGuest('https://example.com', { axNodes: [] });
    setBrowserGuest(guest);
    await expect(snapshotBrowser()).resolves.toBe('');
    clearBrowserGuest(guest);
  });
});

describe('queryBrowserElement', () => {
  it('returns the descriptor of the first match (any origin)', async () => {
    const guest = fakeGuest('https://example.com', { target: TARGET });
    setBrowserGuest(guest);
    await expect(queryBrowserElement('button')).resolves.toEqual(TARGET);
    clearBrowserGuest(guest);
  });

  it('returns null when nothing matches', async () => {
    const guest = fakeGuest('http://localhost:3000', { target: null });
    setBrowserGuest(guest);
    await expect(queryBrowserElement('.nope')).resolves.toBeNull();
    clearBrowserGuest(guest);
  });

  it('rejects an empty selector', async () => {
    setBrowserGuest(fakeGuest('http://localhost:3000'));
    await expect(queryBrowserElement('')).rejects.toThrow(/non-empty/);
  });
});

describe('clickInBrowser', () => {
  it('dispatches a synthetic mouse click at the element centre (local origin)', async () => {
    const guest = fakeGuest('http://localhost:3000', { target: TARGET });
    setBrowserGuest(guest);
    await expect(clickInBrowser('button')).resolves.toEqual({ clicked: 'button' });
    const mouse = guest.sent.filter((c) => c.method === 'Input.dispatchMouseEvent');
    expect(mouse.map((c) => (c.params as { type: string }).type)).toEqual([
      'mouseMoved',
      'mousePressed',
      'mouseReleased',
    ]);
    expect(mouse[1].params).toMatchObject({ x: 50, y: 20, button: 'left' });
    clearBrowserGuest(guest);
  });

  it('refuses to click on a non-local origin', async () => {
    const guest = fakeGuest('https://example.com', { target: TARGET });
    setBrowserGuest(guest);
    await expect(clickInBrowser('button')).rejects.toThrow(/non-local/);
    expect(guest.sent.some((c) => c.method === 'Input.dispatchMouseEvent')).toBe(false);
    clearBrowserGuest(guest);
  });

  it('throws when the selector matches nothing', async () => {
    const guest = fakeGuest('http://localhost:3000', { target: null });
    setBrowserGuest(guest);
    await expect(clickInBrowser('.nope')).rejects.toThrow(/no element matches/);
    clearBrowserGuest(guest);
  });
});

describe('fillInBrowser', () => {
  it('focuses the element then inserts the text (local origin)', async () => {
    const guest = fakeGuest('http://localhost:3000', { target: { ...TARGET, tag: 'input' } });
    setBrowserGuest(guest);
    await expect(fillInBrowser('input', 'hello')).resolves.toEqual({ filled: 'input' });
    expect(guest.sent.some((c) => c.method === 'Input.dispatchMouseEvent')).toBe(true);
    const insert = guest.sent.find((c) => c.method === 'Input.insertText');
    expect(insert?.params).toEqual({ text: 'hello' });
    clearBrowserGuest(guest);
  });

  it('refuses to fill on a non-local origin', async () => {
    const guest = fakeGuest('https://example.com', { target: TARGET });
    setBrowserGuest(guest);
    await expect(fillInBrowser('input', 'x')).rejects.toThrow(/non-local/);
    expect(guest.sent.some((c) => c.method === 'Input.insertText')).toBe(false);
    clearBrowserGuest(guest);
  });

  it('rejects a non-string text payload', async () => {
    setBrowserGuest(fakeGuest('http://localhost:3000', { target: TARGET }));
    await expect(fillInBrowser('input', 123 as unknown as string)).rejects.toThrow(/<text> string/);
  });
});
