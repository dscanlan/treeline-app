import { createServer, type Server, type Socket } from 'node:net';
import { chmodSync, unlinkSync } from 'node:fs';
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

  constructor(
    private readonly socketPath: string,
    private readonly handlers: CliHandlerMap,
  ) {}

  /** Bind the socket. Removes a stale socket file from a prior crash first. */
  async start(): Promise<void> {
    // A leftover socket file from an unclean shutdown would make listen() fail
    // with EADDRINUSE even though nothing is listening. Best-effort unlink; if
    // a *live* server still owns it, listen() below rejects and the caller logs.
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
    try {
      unlinkSync(this.socketPath);
    } catch {
      /* already gone */
    }
  }
}
