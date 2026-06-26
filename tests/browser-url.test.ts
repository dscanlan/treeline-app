import { describe, expect, it } from 'vitest';
import { isLocalDevUrl, normalizeBrowserUrl } from '@shared/browser-url';

describe('normalizeBrowserUrl', () => {
  it('passes through http(s) URLs unchanged', () => {
    expect(normalizeBrowserUrl('http://localhost:3000')).toBe('http://localhost:3000');
    expect(normalizeBrowserUrl('https://example.com/path?q=1')).toBe(
      'https://example.com/path?q=1',
    );
    expect(normalizeBrowserUrl('HTTPS://Example.com')).toBe('HTTPS://Example.com');
  });

  it('assumes http:// for scheme-less input (dev servers, bare hosts)', () => {
    expect(normalizeBrowserUrl('localhost:3000')).toBe('http://localhost:3000');
    expect(normalizeBrowserUrl('127.0.0.1:8080/app')).toBe('http://127.0.0.1:8080/app');
    expect(normalizeBrowserUrl('example.com')).toBe('http://example.com');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeBrowserUrl('  localhost:5173  ')).toBe('http://localhost:5173');
  });

  it('returns null for empty / whitespace-only input', () => {
    expect(normalizeBrowserUrl('')).toBeNull();
    expect(normalizeBrowserUrl('   ')).toBeNull();
  });

  it('passes through file:// URLs unchanged (open local HTML)', () => {
    expect(normalizeBrowserUrl('file:///Users/me/build/index.html')).toBe(
      'file:///Users/me/build/index.html',
    );
    expect(normalizeBrowserUrl('  file:///tmp/coverage/index.html  ')).toBe(
      'file:///tmp/coverage/index.html',
    );
    expect(normalizeBrowserUrl('FILE:///tmp/x.html')).toBe('FILE:///tmp/x.html');
  });

  it('rejects other non-web schemes', () => {
    expect(normalizeBrowserUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeBrowserUrl('data:text/html,<h1>x</h1>')).toBeNull();
    expect(normalizeBrowserUrl('chrome://settings')).toBeNull();
  });
});

describe('isLocalDevUrl', () => {
  it('is true for http(s) URLs on a local host', () => {
    expect(isLocalDevUrl('http://localhost:5173/')).toBe(true);
    expect(isLocalDevUrl('http://127.0.0.1:8080/app')).toBe(true);
    expect(isLocalDevUrl('https://localhost:3000')).toBe(true);
    expect(isLocalDevUrl('http://[::1]:5174/')).toBe(true);
  });

  it('is false for remote hosts and non-web schemes', () => {
    expect(isLocalDevUrl('https://example.com')).toBe(false);
    expect(isLocalDevUrl('http://192.168.1.10:3000')).toBe(false);
    expect(isLocalDevUrl('file:///etc/passwd')).toBe(false);
    expect(isLocalDevUrl('localhost:3000')).toBe(false); // not fully-qualified
    expect(isLocalDevUrl('not a url')).toBe(false);
  });
});
