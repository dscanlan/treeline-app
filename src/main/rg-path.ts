import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';

/**
 * Resolve the ripgrep binary path — the one electron-dependent piece of the
 * search feature (packaged layout vs dev `node_modules`), kept out of the pure
 * `search.ts` so that stays unit-testable.
 *
 * - **Packaged:** `electron-builder.yml` ships per-arch binaries via
 *   `extraResources` to `<Resources>/rg/<arch>/rg`. We pick by `process.arch`
 *   so the universal2 build runs the matching slice on both Apple Silicon and
 *   Intel.
 * - **Dev:** `@vscode/ripgrep` installs a per-platform optional-dep package
 *   (`@vscode/ripgrep-darwin-arm64/bin/rg`) for the host arch; resolve it from
 *   the project's `node_modules` rather than importing the ESM wrapper (which
 *   the bundled main can't reliably `require.resolve` through).
 */
let cached: string | null = null;

function binaryName(): string {
  return process.platform === 'win32' ? 'rg.exe' : 'rg';
}

export function resolveRgPath(): string {
  if (cached) return cached;

  const candidates: string[] = [];
  if (app.isPackaged) {
    candidates.push(join(process.resourcesPath, 'rg', process.arch, binaryName()));
    // Fallback to a flat layout if a single-arch build shipped it un-nested.
    candidates.push(join(process.resourcesPath, 'rg', binaryName()));
  } else {
    // Dev: the per-platform package lives in the project's node_modules. Don't
    // assume app.getAppPath() is the project root — when the built main is run
    // directly (e2e harness) it's `out/main`, so also try walking up from there
    // and process.cwd(). require.resolve would also work but is fragile through
    // the rollup-bundled main, so resolve by path against several bases.
    const rel = join(
      'node_modules',
      '@vscode',
      `ripgrep-${process.platform}-${process.arch}`,
      'bin',
      binaryName(),
    );
    const appPath = app.getAppPath();
    for (const base of [appPath, join(appPath, '..', '..'), process.cwd()]) {
      candidates.push(join(base, rel));
    }
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      cached = candidate;
      return candidate;
    }
  }
  throw new Error(
    `ripgrep binary not found (looked in: ${candidates.join(', ')}). ` +
      `Search is unavailable.`,
  );
}
