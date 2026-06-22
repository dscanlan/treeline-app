/**
 * Copy text to the system clipboard. Returns whether it succeeded so callers can
 * show a transient "Copied" / "Copy failed" affordance.
 *
 * Uses the async Clipboard API (available in Electron's renderer). NOTE: verify
 * this works in the *packaged* build, not just `npm run dev` — clipboard
 * permissions can differ there.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    console.error('copyToClipboard failed', err);
    return false;
  }
}
