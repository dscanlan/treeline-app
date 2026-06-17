import { afterEach, describe, expect, it } from 'vitest';
import { connect } from 'node:net';
import { existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CliServer, type CliHandlerMap } from '../src/main/cli-server';
import type { CliResponse } from '../src/shared/cli-protocol';

let server: CliServer | null = null;

afterEach(async () => {
  await server?.stop();
  server = null;
});

function sockPath(): string {
  // Short path: unix socket names are length-capped (~104 bytes on macOS).
  return join(tmpdir(), `tl-cli-${process.pid}-${Math.random().toString(36).slice(2)}.sock`);
}

/** Open a connection, send one or more frames, collect the reply lines. */
function roundtrip(path: string, lines: string[]): Promise<CliResponse[]> {
  return new Promise((resolve, reject) => {
    const sock = connect(path);
    const out: CliResponse[] = [];
    let buf = '';
    sock.setEncoding('utf8');
    sock.on('connect', () => sock.write(lines.join('')));
    sock.on('data', (chunk: string) => {
      buf += chunk;
      let nl: number;
      while ((nl = buf.indexOf('\n')) !== -1) {
        out.push(JSON.parse(buf.slice(0, nl)) as CliResponse);
        buf = buf.slice(nl + 1);
        if (out.length === lines.length) {
          sock.end();
          resolve(out);
        }
      }
    });
    sock.on('error', reject);
  });
}

const handlers: CliHandlerMap = {
  ping: () => ({ pong: true }),
  echo: (args) => args,
  novalue: () => undefined,
  boom: () => {
    throw new Error('kaboom');
  },
};

describe('CliServer', () => {
  it('starts, dispatches a verb, and chmods the socket 0600', async () => {
    const path = sockPath();
    server = new CliServer(path, handlers);
    await server.start();

    expect(existsSync(path)).toBe(true);
    expect(statSync(path).mode & 0o777).toBe(0o600);

    const [res] = await roundtrip(path, ['{"verb":"ping"}\n']);
    expect(res).toEqual({ ok: true, data: { pong: true } });
  });

  it('passes args through and omits data when the handler returns undefined', async () => {
    const path = sockPath();
    server = new CliServer(path, handlers);
    await server.start();

    const [echo, none] = await roundtrip(path, [
      '{"verb":"echo","args":{"a":1}}\n',
      '{"verb":"novalue"}\n',
    ]);
    expect(echo).toEqual({ ok: true, data: { a: 1 } });
    expect(none).toEqual({ ok: true });
  });

  it('reports unknown verbs and handler errors without crashing', async () => {
    const path = sockPath();
    server = new CliServer(path, handlers);
    await server.start();

    const [unknown, boom, bad] = await roundtrip(path, [
      '{"verb":"missing"}\n',
      '{"verb":"boom"}\n',
      'not json\n',
    ]);
    expect(unknown).toEqual({ ok: false, error: 'unknown verb: missing' });
    expect(boom).toEqual({ ok: false, error: 'kaboom' });
    expect((bad as { ok: boolean }).ok).toBe(false);
  });

  it('removes the socket file on stop and tolerates a stale socket on restart', async () => {
    const path = sockPath();
    server = new CliServer(path, handlers);
    await server.start();
    await server.stop();
    expect(existsSync(path)).toBe(false);

    // A second server on the same path must succeed (start() unlinks stale files).
    server = new CliServer(path, handlers);
    await server.start();
    const [res] = await roundtrip(path, ['{"verb":"ping"}\n']);
    expect(res).toEqual({ ok: true, data: { pong: true } });
  });
});
