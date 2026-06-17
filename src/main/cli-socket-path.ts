import { join } from 'node:path';

/**
 * Path of the app's CLI control socket, given Electron's userData dir
 * (`app.getPath('userData')`, e.g. `~/Library/Application Support/treeline-app`
 * on macOS). Keeping it under userData makes it user-scoped by construction —
 * see the security note in `cli-server.ts`. The standalone CLI binary
 * (`bin/treeline.mjs`) computes the same path independently and honours the
 * `TREELINE_SOCK` override; keep the two in sync.
 */
export function cliSocketPath(userDataDir: string): string {
  return process.env['TREELINE_SOCK'] || join(userDataDir, 'cli.sock');
}
