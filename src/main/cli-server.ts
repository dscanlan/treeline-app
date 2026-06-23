import { connect, createServer, type Server, type Socket } from 'node:net';
import { chmodSync, statSync, unlinkSync } from 'node:fs';
import {
  encodeFrame,
  type CliRequest,
  type CliResponse,
} from '@shared/cli-protocol';

/** A verb handler: takes the request args, returns the response payload. */
export type CliHandler = (args: Record<string, unknown>) => Promise<unknown> | unknown;

export type CliHandlerMap = Record<string, CliHandler>;

/**
 * Newline-delimited-JSON server over a unix domain socket. The running app's
 * main process listens; the `treeline` CLI (and any other tool/agent) connects,
 * writes one `{verb,args}` line, reads one `{ok,…}` line, and disconnects.
 *
 * Security posture (per the idea note): the socket grants control of the app
 * and thus its PTYs, so it is user-scoped (lives under the app's userData dir)
 * and chmod 0600 — owner-only, never bound to a network interface.
 *
 * The class is deliberately free of Electron imports so it can be unit-tested
 * by connecting a plain `net.Socket`, mirroring how PtyManager takes an
 * injected spawn fn to stay testable.
 */
export class CliServer {
  private server: Server | null = null;
  private readonly sockets = new Set<Socket>();
  /**
   * Inode of the socket file we bound, captured at listen time. `stop()` unlinks
   * only when the path still resolves to *this* inode — so a successor instance
   * that re-bound the same path (the relaunch-overlap race) doesn't get its live
   * socket file deleted out from under it when we later shut down.
   */
  private boundInode: number | null = null;

  constructor(
    private readonly socketPath: string,
    private readonly handlers: CliHandlerMap,
  ) {}

  /**
   * Bind the socket. A leftover file at the path has two possible owners:
   *   - a *dead* socket from a prior unclean shutdown — safe to remove; or
   *   - a *live* instance currently listening — removing its file would silently
   *     sever it (connections to the path would hit a now-orphaned inode and be
   *     refused), which is exactly the bug that kills agent-attention rings.
   * So we probe before unlinking: if anything accepts a connection, the path is
   * owned by a live peer and we refuse to start. Only a confirmed-dead (or
   * absent) file is unlinked. With the single-instance lock in main this is rare,
   * but it backstops the auto-update relaunch overlap the lock can't cover.
   */
  async start(): Promise<void> {
    if (await isSocketLive(this.socketPath)) {
      throw new Error(
        `CLI socket already owned by a live instance: ${this.socketPath}`,
      );
    }
    try {
      unlinkSync(this.socketPath);
    } catch {
      /* no stale socket — fine */
    }

    await new Promise<void>((resolve, reject) => {
      const server = createServer((sock) => this.onConnection(sock));
      server.once('error', reject);
      server.listen(this.socketPath, () => {
        server.removeListener('error', reject);
        // Owner-only: the socket is as powerful as the user's shell.
        try {
          chmodSync(this.socketPath, 0o600);
        } catch {
          /* chmod is defense in depth; the dir is already user-scoped */
        }
        try {
          this.boundInode = statSync(this.socketPath).ino;
        } catch {
          /* couldn't stat our own socket — leave inode unknown, stop() is then conservative */
        }
        this.server = server;
        resolve();
      });
    });
  }

  private onConnection(sock: Socket): void {
    this.sockets.add(sock);
    let buffer = '';
    sock.setEncoding('utf8');
    sock.on('data', (chunk: string) => {
      buffer += chunk;
      let nl: number;
      // Process every complete line; a tail without a newline stays buffered.
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (line.trim().length > 0) void this.dispatch(sock, line);
      }
    });
    sock.on('error', () => sock.destroy());
    sock.on('close', () => this.sockets.delete(sock));
  }

  private async dispatch(sock: Socket, line: string): Promise<void> {
    let res: CliResponse;
    try {
      const req = JSON.parse(line) as CliRequest;
      const verb = typeof req.verb === 'string' ? req.verb : '';
      const handler = this.handlers[verb];
      if (!handler) {
        res = { ok: false, error: `unknown verb: ${verb || '(empty)'}` };
      } else {
        const data = await handler(req.args ?? {});
        res = data === undefined ? { ok: true } : { ok: true, data };
      }
    } catch (err) {
      res = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    if (!sock.destroyed) sock.write(encodeFrame(res));
  }

  /** Close the server and drop the socket file. Safe to call if never started. */
  async stop(): Promise<void> {
    for (const sock of this.sockets) sock.destroy();
    this.sockets.clear();
    const server = this.server;
    this.server = null;
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    // Only remove the file if it's still *our* socket. During an auto-update
    // relaunch the successor may already have re-bound this exact path; deleting
    // its file here would orphan it (the very failure this guards against). A
    // mismatched or unknown inode means someone else owns the path now — leave it.
    try {
      if (this.boundInode !== null && statSync(this.socketPath).ino === this.boundInode) {
        unlinkSync(this.socketPath);
      }
    } catch {
      /* already gone, or can't stat — nothing safe to remove */
    }
    this.boundInode = null;
  }
}

/**
 * Probe whether a unix socket path has a live listener. Resolves true only when
 * a connection is accepted; ECONNREFUSED (stale file, no listener) and ENOENT
 * (no file) both resolve false. A short timeout guards against a wedged peer.
 */
function isSocketLive(socketPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (live: boolean) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      resolve(live);
    };
    const sock = connect(socketPath);
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
    sock.setTimeout(500, () => done(false));
  });
}
