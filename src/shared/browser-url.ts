// URL helper for the embedded browser pane. Lives in `shared/` (pure, no deps)
// so it can be unit-tested under the node tsconfig. The pane navigates to web
// content (http/https) and local files (file://) typed into the address bar —
// never javascript:, data:, chrome:, etc.

const WEB_SCHEME = /^https?:\/\//i;
// A local-file URL. Only honoured for address-bar / CLI input (an explicit user
// action), not for attacker-influenceable clicked links — see
// `isPaneNavigableUrl`.
const FILE_SCHEME = /^file:\/\//i;
// A real URL scheme: letters/digits/+-. then ':' NOT immediately followed by a
// digit. The negative lookahead is what keeps `localhost:3000` (host:port) from
// being mistaken for a `localhost:` scheme.
const NON_WEB_SCHEME = /^[a-z][a-z0-9+.-]*:(?![0-9])/i;

/**
 * Turn whatever the user typed in the address bar into a loadable URL, or
 * `null` if it isn't navigable.
 *
 * - Already an http(s) URL → used as-is.
 * - A `file://` URL → used as-is, so you can open local HTML (build output,
 *   coverage reports, saved pages) without leaving treeline.
 * - Any other explicit scheme (javascript:, data:, chrome:, …) → null; the pane
 *   refuses to load those.
 * - Scheme-less input (`localhost:3000`, `127.0.0.1`, `example.com/path`) →
 *   assumed `http://` — the dominant case here is a local dev server, and real
 *   sites redirect http→https themselves.
 */
export function normalizeBrowserUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (WEB_SCHEME.test(trimmed)) return trimmed;
  if (FILE_SCHEME.test(trimmed)) return trimmed;
  if (NON_WEB_SCHEME.test(trimmed)) return null;
  return `http://${trimmed}`;
}

/**
 * True when a link clicked in terminal output should open in the embedded
 * browser pane rather than being handed to the OS browser. Web content stays
 * inside treeline — you click a URL a command printed and read it in the pane,
 * without a context switch.
 *
 * Deliberately narrower than `normalizeBrowserUrl`, which serves the address
 * bar and CLI (explicit user input):
 *
 * - Requires a fully-qualified http(s) URL. Scheme-less text is not inferred
 *   into `http://` here — terminal output is attacker-influenceable, and a bare
 *   word shouldn't become a navigation.
 * - `file://` is excluded even though the pane can load it, so printed output
 *   can't turn one click into a local-file read. Those, `mailto:`, and every
 *   custom scheme fall through to the OS path, which main's `isSafeExternalUrl`
 *   allowlist then filters.
 */
export function isPaneNavigableUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}
