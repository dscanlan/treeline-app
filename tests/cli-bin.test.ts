import { afterEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { createServer, type Server } from 'node:net';
import { mkdtempSync, readFileSync, rmSync, lstatSync, readlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../bin/treeline.mjs', import.meta.url));

const tmps: string[] = [];
const servers: Server[] = [];

afterEach(() => {
  for (const s of servers.splice(0)) s.close();
  for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'tl-bin-'));
  tmps.push(d);
  return d;
}

function run(
  args: string[],
  opts: { env?: Record<string, string>; stdin?: string } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = execFile(
      process.execPath,
      [BIN, ...args],
      { env: { ...process.env, ...opts.env } },
      (err, stdout, stderr) => {
        resolve({ code: err && typeof err.code === 'number' ? err.code : 0, stdout, stderr });
      },
    );
    if (opts.stdin !== undefined) {
      child.stdin?.end(opts.stdin);
    }
  });
}

/** Stub socket server that captures the first frame it receives and replies ok. */
function stubServer(sockPath: string): { received: Promise<Record<string, unknown>> } {
  let resolveFrame: (v: Record<string, unknown>) => void;
  const received = new Promise<Record<string, unknown>>((r) => (resolveFrame = r));
  const server = createServer((sock) => {
    let buf = '';
    sock.setEncoding('utf8');
    sock.on('data', (chunk: string) => {
      buf += chunk;
      const nl = buf.indexOf('\n');
      if (nl === -1) return;
      resolveFrame(JSON.parse(buf.slice(0, nl)));
      sock.end('{"ok":true}\n');
    });
  });
  server.listen(sockPath);
  servers.push(server);
  return { received };
}

describe('treeline hooks setup', () => {
  it('wires Stop + Notification hooks and symlinks the binary', async () => {
    const cfg = tmp();
    const bin = tmp();
    const res = await run(['hooks', 'setup', '--bin-dir', bin], {
      env: { CLAUDE_CONFIG_DIR: cfg },
    });
    expect(res.code).toBe(0);

    const settings = JSON.parse(readFileSync(join(cfg, 'settings.json'), 'utf8'));
    for (const event of ['Stop', 'Notification']) {
      const cmd = settings.hooks[event][0].hooks[0].command;
      expect(cmd).toContain('notify-hook');
      expect(cmd).toContain(BIN); // absolute path, not PATH-dependent
    }

    // Symlink points back at the script.
    const link = join(bin, 'treeline');
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readlinkSync(link)).toBe(BIN);
  });

  it('is idempotent — a second setup adds nothing and preserves other keys', async () => {
    const cfg = tmp();
    const bin = tmp();
    const env = { CLAUDE_CONFIG_DIR: cfg };
    // Seed an unrelated setting and a pre-existing hook on the same event.
    const settingsPath = join(cfg, 'settings.json');
    rmSync(settingsPath, { force: true });
    const seed = {
      model: 'opus',
      hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo hi' }] }] },
    };
    const { writeFileSync, mkdirSync } = await import('node:fs');
    mkdirSync(cfg, { recursive: true });
    writeFileSync(settingsPath, JSON.stringify(seed));

    await run(['hooks', 'setup', '--bin-dir', bin], { env });
    const second = await run(['hooks', 'setup', '--bin-dir', bin], { env });
    expect(second.stdout).toContain('already present');

    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    expect(settings.model).toBe('opus'); // untouched
    // The pre-existing echo hook is preserved, ours is added once (not duplicated).
    const cmds = settings.hooks.Stop.flatMap((g: { hooks: { command: string }[] }) =>
      g.hooks.map((h) => h.command),
    );
    expect(cmds.filter((c: string) => c.includes('notify-hook'))).toHaveLength(1);
    expect(cmds).toContain('echo hi');
  });

  it('hooks remove strips our hooks but leaves others', async () => {
    const cfg = tmp();
    const bin = tmp();
    const env = { CLAUDE_CONFIG_DIR: cfg };
    await run(['hooks', 'setup', '--bin-dir', bin], { env });
    const res = await run(['hooks', 'remove'], { env });
    expect(res.code).toBe(0);

    const settings = JSON.parse(readFileSync(join(cfg, 'settings.json'), 'utf8'));
    const stop = settings.hooks?.Stop ?? [];
    const cmds = stop.flatMap((g: { hooks: { command: string }[] }) => g.hooks.map((h) => h.command));
    expect(cmds.some((c: string) => c.includes('notify-hook'))).toBe(false);
  });
});

describe('treeline browser', () => {
  it('navigate sends a browser/navigate frame with the raw url', async () => {
    const sock = join(tmp(), 's.sock');
    const { received } = stubServer(sock);
    const res = await run(['browser', 'navigate', 'localhost:3000'], {
      env: { TREELINE_SOCK: sock },
    });
    expect(res.code).toBe(0);
    expect(await received).toEqual({
      verb: 'browser',
      args: { action: 'navigate', url: 'localhost:3000' },
    });
  });

  it('eval joins the remaining args into the code frame', async () => {
    const sock = join(tmp(), 's.sock');
    const { received } = stubServer(sock);
    await run(['browser', 'eval', 'document.title', '||', '"x"'], {
      env: { TREELINE_SOCK: sock },
    });
    expect((await received).args).toEqual({ action: 'eval', code: 'document.title || "x"' });
  });

  it('navigate --wait sets the wait flag in the frame', async () => {
    const sock = join(tmp(), 's.sock');
    const { received } = stubServer(sock);
    await run(['browser', 'navigate', 'localhost:3000', '--wait'], {
      env: { TREELINE_SOCK: sock },
    });
    expect((await received).args).toEqual({
      action: 'navigate',
      url: 'localhost:3000',
      wait: true,
    });
  });

  it('screenshot resolves a relative out-path to an absolute one', async () => {
    const sock = join(tmp(), 's.sock');
    const { received } = stubServer(sock);
    await run(['browser', 'screenshot', './shot.png'], { env: { TREELINE_SOCK: sock } });
    const args = (await received).args as { action: string; path: string };
    expect(args.action).toBe('screenshot');
    expect(args.path.startsWith('/')).toBe(true);
    expect(args.path).toMatch(/\/shot\.png$/);
  });

  it('fails (exit 2) on an unknown browser action', async () => {
    const res = await run(['browser', 'fly'], { env: { TREELINE_SOCK: join(tmp(), 'x.sock') } });
    expect(res.code).toBe(2);
    expect(res.stderr).toContain('unknown action');
  });
});

describe('treeline notify-hook', () => {
  it('derives a message from the hook payload and fires notify (exit 0)', async () => {
    const sock = join(tmp(), 's.sock');
    const { received } = stubServer(sock);
    const res = await run(['notify-hook'], {
      env: { TREELINE_SOCK: sock },
      stdin: JSON.stringify({ hook_event_name: 'Stop', cwd: '/code/my-app' }),
    });
    expect(res.code).toBe(0);
    const frame = await received;
    expect(frame).toEqual({ verb: 'notify', args: { text: 'Claude finished responding — my-app' } });
  });

  it('prefers an explicit message field from the payload', async () => {
    const sock = join(tmp(), 's.sock');
    const { received } = stubServer(sock);
    await run(['notify-hook'], {
      env: { TREELINE_SOCK: sock },
      stdin: JSON.stringify({ hook_event_name: 'Notification', message: 'Permission needed' }),
    });
    expect((await received).args).toEqual({ text: 'Permission needed' });
  });

  it('exits 0 even when the app is not running', async () => {
    const res = await run(['notify-hook'], {
      env: { TREELINE_SOCK: join(tmp(), 'nope.sock') },
      stdin: JSON.stringify({ hook_event_name: 'Stop' }),
    });
    expect(res.code).toBe(0);
    expect(existsSync(BIN)).toBe(true);
  });
});
