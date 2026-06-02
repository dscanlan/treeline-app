/** Schemes we'll hand to the OS from a renderer-initiated link click. */
const SAFE_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

/**
 * Guards `shell.openExternal` against hostile link clicks. The renderer's
 * terminal (xterm + WebLinksAddon, OSC 8 hyperlinks) turns arbitrary,
 * attacker-influenceable output into clickable links — a printed `file://`,
 * `smb://`, or custom-handler URL could launch a local handler or exfiltrate
 * over SMB on a single click. Only web/mail schemes are allowed through;
 * everything else, and anything that doesn't parse as a URL, is rejected.
 */
export function isSafeExternalUrl(url: string): boolean {
  try {
    return SAFE_EXTERNAL_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    return false; // unparseable URL — don't open it
  }
}
