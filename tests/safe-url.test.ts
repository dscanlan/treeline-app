import { describe, expect, it } from 'vitest';
import { isSafeExternalUrl } from '../src/main/util/safe-url';

describe('isSafeExternalUrl', () => {
  it('allows http, https, and mailto', () => {
    expect(isSafeExternalUrl('http://example.com')).toBe(true);
    expect(isSafeExternalUrl('https://example.com/path?q=1#frag')).toBe(true);
    expect(isSafeExternalUrl('mailto:someone@example.com')).toBe(true);
  });

  it('blocks local-handler and exfiltration schemes', () => {
    expect(isSafeExternalUrl('file:///etc/passwd')).toBe(false);
    expect(isSafeExternalUrl('smb://attacker/share')).toBe(false);
    expect(isSafeExternalUrl('vscode://file/etc/passwd')).toBe(false);
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeExternalUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
  });

  it('rejects anything that does not parse as a URL', () => {
    expect(isSafeExternalUrl('not a url')).toBe(false);
    expect(isSafeExternalUrl('')).toBe(false);
    expect(isSafeExternalUrl('example.com')).toBe(false); // no scheme
  });

  it('is not fooled by scheme casing or embedded safe-looking text', () => {
    // URL normalises the protocol to lower-case, so this is genuinely https.
    expect(isSafeExternalUrl('HTTPS://example.com')).toBe(true);
    // A javascript URL that mentions https in its body is still javascript:.
    expect(isSafeExternalUrl('javascript:void("https://example.com")')).toBe(false);
  });
});
