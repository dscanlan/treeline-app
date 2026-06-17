// URL helper for the embedded browser pane. Lives in `shared/` (pure, no deps)
// so it can be unit-tested under the node tsconfig. The pane only navigates to
// web content (http/https) — never file:, data:, javascript:, etc.

const WEB_SCHEME = /^https?:\/\//i;
// A real URL scheme: letters/digits/+-. then ':' NOT immediately followed by a
// digit. The negative lookahead is what keeps `localhost:3000` (host:port) from
// being mistaken for a `localhost:` scheme.
const NON_WEB_SCHEME = /^[a-z][a-z0-9+.-]*:(?![0-9])/i;

/**
 * Turn whatever the user typed in the address bar into a loadable http(s) URL,
 * or `null` if it isn't navigable.
 *
 * - Already an http(s) URL → used as-is.
 * - Any other explicit scheme (file:, javascript:, data:, chrome:, …) → null;
 *   the pane refuses to load non-web content.
 * - Scheme-less input (`localhost:3000`, `127.0.0.1`, `example.com/path`) →
 *   assumed `http://` — the dominant case here is a local dev server, and real
 *   sites redirect http→https themselves.
 */
export function normalizeBrowserUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (WEB_SCHEME.test(trimmed)) return trimmed;
  if (NON_WEB_SCHEME.test(trimmed)) return null;
  return `http://${trimmed}`;
}
