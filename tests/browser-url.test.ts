import { describe, expect, it } from 'vitest';
import { normalizeBrowserUrl } from '@shared/browser-url';

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

  it('rejects non-web schemes', () => {
    expect(normalizeBrowserUrl('file:///etc/passwd')).toBeNull();
    expect(normalizeBrowserUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeBrowserUrl('data:text/html,<h1>x</h1>')).toBeNull();
    expect(normalizeBrowserUrl('chrome://settings')).toBeNull();
  });
});
