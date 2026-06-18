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
} from '../src/main/browser-guest';

/**
 * A minimal stand-in for the guest <webview> WebContents. Only the methods
 * browser-guest touches are implemented; the `electron` import is type-only so
 * these tests run under vitest without an Electron runtime.
 */
function fakeGuest(url: string): WebContents {
  return {
    isDestroyed: () => false,
    isLoading: () => false,
    getURL: () => url,
    executeJavaScript: vi.fn(async (code: string) => `ran:${code}`),
    capturePage: vi.fn(async () => ({
      toDataURL: () => 'data:image/png;base64,ZZ',
      toPNG: () => Buffer.from('PNGDATA'),
    })),
  } as unknown as WebContents;
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
