import { afterEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { createServer, type Server } from 'node:net';
import { mkdtempSync, readFileSync, rmSync, lstatSync, readlinkSync, existsSync, writeFileSync } from 'node:fs';
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
    // …and the SessionStart hook that reports each pane's session id.
    const sessionCmd = settings.hooks.SessionStart[0].hooks[0].command;
    expect(sessionCmd).toContain('claude-session-hook');
    expect(sessionCmd).toContain(BIN);

    // Symlink points back at the script.
    const link = join(bin, 'treeline');
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readlinkSync(link)).toBe(BIN);
  });

  it('re-running setup upgrades an old install with the missing SessionStart hook', async () => {
    const cfg = tmp();
    const bin = tmp();
    const env = { CLAUDE_CONFIG_DIR: cfg };
    // An install from before per-pane pinning: notify hooks present, no SessionStart.
    const { writeFileSync, mkdirSync } = await import('node:fs');
    mkdirSync(cfg, { recursive: true });
    writeFileSync(
      join(cfg, 'settings.json'),
      JSON.stringify({
        hooks: {
          Stop: [{ hooks: [{ type: 'command', command: `${BIN} notify-hook` }] }],
          Notification: [{ hooks: [{ type: 'command', command: `${BIN} notify-hook` }] }],
        },
      }),
    );

    const res = await run(['hooks', 'setup', '--bin-dir', bin], { env });
    expect(res.stdout).toContain('added 1');

    const settings = JSON.parse(readFileSync(join(cfg, 'settings.json'), 'utf8'));
    expect(settings.hooks.SessionStart[0].hooks[0].command).toContain('claude-session-hook');
    // The notify hooks weren't duplicated.
    expect(settings.hooks.Stop).toHaveLength(1);
    expect(settings.hooks.Notification).toHaveLength(1);
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
    // The SessionStart hook is ours too — removed along with the notify pair.
    expect(settings.hooks?.SessionStart).toBeUndefined();
  });
});

describe('treeline send', () => {
  it('keeps the original focused-pane request when no target is given', async () => {
    const sock = join(tmp(), 's.sock');
    const { received } = stubServer(sock);
    const res = await run(['send', 'npm test\\n'], { env: { TREELINE_SOCK: sock } });
    expect(res.code).toBe(0);
    expect(await received).toEqual({ verb: 'send', args: { text: 'npm test\n' } });
  });

  it('--self targets the pane inherited through $TREELINE_PANE_ID', async () => {
    const sock = join(tmp(), 's.sock');
    const { received } = stubServer(sock);
    const res = await run(['send', '--self', '/clear\\n'], {
      env: { TREELINE_SOCK: sock, TREELINE_PANE_ID: 'pane-own' },
    });
    expect(res.code).toBe(0);
    expect(await received).toEqual({
      verb: 'send',
      args: { text: '/clear\n', paneId: 'pane-own' },
    });
  });

  it('--pane targets an explicit pane id', async () => {
    const sock = join(tmp(), 's.sock');
    const { received } = stubServer(sock);
    await run(['send', '--pane', 'pane-7', 'echo ok\\n'], {
      env: { TREELINE_SOCK: sock },
    });
    expect(await received).toEqual({
      verb: 'send',
      args: { text: 'echo ok\n', paneId: 'pane-7' },
    });
  });

  it('--self fails clearly outside a Treeline pane', async () => {
    const res = await run(['send', '--self', '/clear\\n'], {
      env: { TREELINE_PANE_ID: '' },
    });
    expect(res.code).toBe(2);
    expect(res.stderr).toContain('requires $TREELINE_PANE_ID');
  });
});

describe('treeline claude-session', () => {
  it('sends the session id with the pane from $TREELINE_PANE_ID', async () => {
    const sock = join(tmp(), 's.sock');
    const { received } = stubServer(sock);
    const res = await run(['claude-session', 'sess-42'], {
      env: { TREELINE_SOCK: sock, TREELINE_PANE_ID: 'pane-abc' },
    });
    expect(res.code).toBe(0);
    expect(await received).toEqual({
      verb: 'claude-session',
      args: { paneId: 'pane-abc', sessionId: 'sess-42' },
    });
  });

  it('an explicit pane-id argument beats the env var', async () => {
    const sock = join(tmp(), 's.sock');
    const { received } = stubServer(sock);
    await run(['claude-session', 'sess-42', 'pane-explicit'], {
      env: { TREELINE_SOCK: sock, TREELINE_PANE_ID: 'pane-env' },
    });
    expect((await received).args).toEqual({ paneId: 'pane-explicit', sessionId: 'sess-42' });
  });

  it('fails (exit 2) without a session id or without any pane id', async () => {
    const none = { TREELINE_SOCK: join(tmp(), 'x.sock'), TREELINE_PANE_ID: '' };
    const noSession = await run(['claude-session'], { env: none });
    expect(noSession.code).toBe(2);
    expect(noSession.stderr).toContain('requires a <session-id>');
    const noPane = await run(['claude-session', 'sess-42'], { env: none });
    expect(noPane.code).toBe(2);
    expect(noPane.stderr).toContain('pane-id');
  });
});

describe('treeline claude-session-hook', () => {
  it('reports {paneId, sessionId} from the SessionStart payload (exit 0)', async () => {
    const sock = join(tmp(), 's.sock');
    const { received } = stubServer(sock);
    const res = await run(['claude-session-hook'], {
      env: { TREELINE_SOCK: sock, TREELINE_PANE_ID: 'pane-abc' },
      stdin: JSON.stringify({
        hook_event_name: 'SessionStart',
        session_id: 'f00dfeed-1234',
        source: 'startup',
        cwd: '/code/my-app',
      }),
    });
    expect(res.code).toBe(0);
    expect(await received).toEqual({
      verb: 'claude-session',
      args: { paneId: 'pane-abc', sessionId: 'f00dfeed-1234' },
    });
  });

  it('exits 0 without reporting when not inside a treeline pane', async () => {
    // No stub server: were the hook to try the (absent) socket it would still
    // exit 0, but the immediate no-pane path must not even need stdin to close.
    const res = await run(['claude-session-hook'], {
      env: { TREELINE_SOCK: join(tmp(), 'nope.sock'), TREELINE_PANE_ID: '' },
      stdin: JSON.stringify({ session_id: 'sess-1' }),
    });
    expect(res.code).toBe(0);
  });

  it('exits 0 on a payload with no session id, and when the app is down', async () => {
    const noSession = await run(['claude-session-hook'], {
      env: { TREELINE_SOCK: join(tmp(), 'x.sock'), TREELINE_PANE_ID: 'pane-abc' },
      stdin: JSON.stringify({ hook_event_name: 'SessionStart' }),
    });
    expect(noSession.code).toBe(0);

    const appDown = await run(['claude-session-hook'], {
      env: { TREELINE_SOCK: join(tmp(), 'gone.sock'), TREELINE_PANE_ID: 'pane-abc' },
      stdin: JSON.stringify({ session_id: 'sess-1' }),
    });
    expect(appDown.code).toBe(0);
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

  it('snapshot sends a bare snapshot frame', async () => {
    const sock = join(tmp(), 's.sock');
    const { received } = stubServer(sock);
    await run(['browser', 'snapshot'], { env: { TREELINE_SOCK: sock } });
    expect((await received).args).toEqual({ action: 'snapshot' });
  });

  it('query carries the selector', async () => {
    const sock = join(tmp(), 's.sock');
    const { received } = stubServer(sock);
    await run(['browser', 'query', 'button.primary'], { env: { TREELINE_SOCK: sock } });
    expect((await received).args).toEqual({ action: 'query', selector: 'button.primary' });
  });

  it('click carries the selector', async () => {
    const sock = join(tmp(), 's.sock');
    const { received } = stubServer(sock);
    await run(['browser', 'click', '#save'], { env: { TREELINE_SOCK: sock } });
    expect((await received).args).toEqual({ action: 'click', selector: '#save' });
  });

  it('fill joins the remaining args into the text frame', async () => {
    const sock = join(tmp(), 's.sock');
    const { received } = stubServer(sock);
    await run(['browser', 'fill', 'input[name=q]', 'hello', 'world'], {
      env: { TREELINE_SOCK: sock },
    });
    expect((await received).args).toEqual({
      action: 'fill',
      selector: 'input[name=q]',
      text: 'hello world',
    });
  });

  it('query fails (exit 2) without a selector', async () => {
    const res = await run(['browser', 'query'], { env: { TREELINE_SOCK: join(tmp(), 'x.sock') } });
    expect(res.code).toBe(2);
    expect(res.stderr).toContain('requires a <selector>');
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
    // Clear TREELINE_PANE_ID: the test runner may itself be inside a treeline
    // pane, and that would non-deterministically inject a paneId here.
    const res = await run(['notify-hook'], {
      env: { TREELINE_SOCK: sock, TREELINE_PANE_ID: '' },
      stdin: JSON.stringify({ hook_event_name: 'Stop', cwd: '/code/my-app' }),
    });
    expect(res.code).toBe(0);
    const frame = await received;
    expect(frame).toEqual({
      verb: 'notify',
      args: { text: 'Claude finished responding — my-app', cwd: '/code/my-app' },
    });
  });

  it('prefers an explicit message field from the payload', async () => {
    const sock = join(tmp(), 's.sock');
    const { received } = stubServer(sock);
    await run(['notify-hook'], {
      env: { TREELINE_SOCK: sock, TREELINE_PANE_ID: '' },
      stdin: JSON.stringify({ hook_event_name: 'Notification', message: 'Permission needed' }),
    });
    expect((await received).args).toEqual({ text: 'Permission needed' });
  });

  it('forwards TREELINE_PANE_ID as paneId so the exact pane lights up', async () => {
    const sock = join(tmp(), 's.sock');
    const { received } = stubServer(sock);
    await run(['notify-hook'], {
      env: { TREELINE_SOCK: sock, TREELINE_PANE_ID: 'pane-abc' },
      stdin: JSON.stringify({ hook_event_name: 'Notification', message: 'Permission needed' }),
    });
    expect((await received).args).toEqual({ text: 'Permission needed', paneId: 'pane-abc' });
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

describe('treeline codex-session-hook', () => {
  it('reports the Codex session id under the exact Treeline pane', async () => {
    const sock = join(tmp(), 's.sock');
    const { received } = stubServer(sock);
    const res = await run(['codex-session-hook'], {
      env: { TREELINE_SOCK: sock, TREELINE_PANE_ID: 'pane-codex' },
      stdin: JSON.stringify({
        hook_event_name: 'SessionStart',
        source: 'startup',
        session_id: '550e8400-e29b-41d4-a716-446655440000',
        cwd: '/repo',
      }),
    });
    expect(res.code).toBe(0);
    expect(await received).toEqual({
      verb: 'agent-session',
      args: {
        paneId: 'pane-codex',
        sessionId: '550e8400-e29b-41d4-a716-446655440000',
        agent: 'codex',
      },
    });
  });
});

describe('treeline codex-notify-hook', () => {
  it('reports a completed Codex turn under the exact Treeline pane', async () => {
    const sock = join(tmp(), 's.sock');
    const { received } = stubServer(sock);
    const res = await run(['codex-notify-hook'], {
      env: { TREELINE_SOCK: sock, TREELINE_PANE_ID: 'pane-codex' },
      stdin: JSON.stringify({
        hook_event_name: 'Stop',
        cwd: '/code/my-app',
      }),
    });
    expect(res.code).toBe(0);
    expect((await received).args).toEqual({
      text: 'Codex finished responding — my-app',
      cwd: '/code/my-app',
      paneId: 'pane-codex',
    });
  });

  it('reports a Codex approval prompt with its human-readable reason', async () => {
    const sock = join(tmp(), 's.sock');
    const { received } = stubServer(sock);
    const res = await run(['codex-notify-hook'], {
      env: { TREELINE_SOCK: sock, TREELINE_PANE_ID: 'pane-codex' },
      stdin: JSON.stringify({
        hook_event_name: 'PermissionRequest',
        cwd: '/repo',
        tool_name: 'Bash',
        tool_input: { command: 'npm publish', description: 'Publish the package?' },
      }),
    });
    expect(res.code).toBe(0);
    expect((await received).args).toEqual({
      text: 'Codex needs approval: Publish the package? — repo',
      cwd: '/repo',
      paneId: 'pane-codex',
    });
  });
});

describe('treeline hooks setup --agent codex', () => {
  it('wires Stop, PermissionRequest, and SessionStart lifecycle hooks', async () => {
    const codexHome = tmp();
    const bin = tmp();
    const res = await run(['hooks', 'setup', '--agent', 'codex', '--bin-dir', bin], {
      env: { CODEX_HOME: codexHome },
    });
    expect(res.code).toBe(0);
    expect(existsSync(join(codexHome, 'config.toml'))).toBe(false);
    const hooks = JSON.parse(readFileSync(join(codexHome, 'hooks.json'), 'utf8'));
    expect(hooks.hooks.Stop).toHaveLength(1);
    expect(hooks.hooks.Stop[0].hooks[0].command).toContain('codex-notify-hook');
    expect(hooks.hooks.Stop[0].hooks[0].command).toContain(BIN);
    expect(hooks.hooks.PermissionRequest).toHaveLength(1);
    expect(hooks.hooks.PermissionRequest[0].hooks[0].command).toContain(
      'codex-notify-hook',
    );
    expect(hooks.hooks.SessionStart).toHaveLength(1);
    expect(hooks.hooks.SessionStart[0]).toMatchObject({
      matcher: 'startup|resume|clear|compact',
    });
    expect(hooks.hooks.SessionStart[0].hooks[0].command).toContain('codex-session-hook');
    expect(hooks.hooks.SessionStart[0].hooks[0].command).toContain(BIN);
  });

  it('is idempotent (setup twice → one hook for each lifecycle event)', async () => {
    const codexHome = tmp();
    const bin = tmp();
    const env = { CODEX_HOME: codexHome };
    await run(['hooks', 'setup', '--agent', 'codex', '--bin-dir', bin], { env });
    const second = await run(['hooks', 'setup', '--agent', 'codex', '--bin-dir', bin], { env });
    expect(second.code).toBe(0);
    expect(second.stdout).toContain('already present');
    const hooks = JSON.parse(readFileSync(join(codexHome, 'hooks.json'), 'utf8'));
    expect(hooks.hooks.Stop).toHaveLength(1);
    expect(hooks.hooks.PermissionRequest).toHaveLength(1);
    expect(hooks.hooks.SessionStart).toHaveLength(1);
  });

  it('leaves existing config.toml keys and tables unchanged', async () => {
    const codexHome = tmp();
    const bin = tmp();
    const original = 'model = "o3"\n\n[shell_environment_policy]\ninherit = "all"\n';
    writeFileSync(join(codexHome, 'config.toml'), original);
    await run(['hooks', 'setup', '--agent', 'codex', '--bin-dir', bin], {
      env: { CODEX_HOME: codexHome },
    });
    expect(readFileSync(join(codexHome, 'config.toml'), 'utf8')).toBe(original);
  });

  it('preserves a foreign notify key while still adding attention hooks', async () => {
    const codexHome = tmp();
    const bin = tmp();
    writeFileSync(join(codexHome, 'config.toml'), 'notify = ["notify-send", "Codex"]\n');
    const res = await run(['hooks', 'setup', '--agent', 'codex', '--bin-dir', bin], {
      env: { CODEX_HOME: codexHome },
    });
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('preserving existing notify');
    // The user's wiring is untouched.
    expect(readFileSync(join(codexHome, 'config.toml'), 'utf8')).toBe(
      'notify = ["notify-send", "Codex"]\n',
    );
    const hooks = JSON.parse(readFileSync(join(codexHome, 'hooks.json'), 'utf8'));
    expect(hooks.hooks.Stop[0].hooks[0].command).toContain('codex-notify-hook');
    expect(hooks.hooks.PermissionRequest[0].hooks[0].command).toContain(
      'codex-notify-hook',
    );
    expect(hooks.hooks.SessionStart[0].hooks[0].command).toContain('codex-session-hook');
  });

  it('migrates its legacy scalar notify wiring to lifecycle hooks', async () => {
    const codexHome = tmp();
    const bin = tmp();
    writeFileSync(
      join(codexHome, 'config.toml'),
      `notify = [${JSON.stringify(BIN)}, "notify-hook"]\nmodel = "o3"\n`,
    );
    const env = { CODEX_HOME: codexHome };
    const res = await run(['hooks', 'setup', '--agent', 'codex', '--bin-dir', bin], { env });
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('removed legacy notify wiring');
    const toml = readFileSync(join(codexHome, 'config.toml'), 'utf8');
    expect(toml).toBe('model = "o3"\n');
    const hooks = JSON.parse(readFileSync(join(codexHome, 'hooks.json'), 'utf8'));
    expect(hooks.hooks.Stop[0].hooks[0].command).toContain('codex-notify-hook');
    expect(hooks.hooks.PermissionRequest[0].hooks[0].command).toContain(
      'codex-notify-hook',
    );
  });

  it('hooks remove --agent codex strips only Treeline lifecycle and legacy entries', async () => {
    const codexHome = tmp();
    const bin = tmp();
    const env = { CODEX_HOME: codexHome };
    await run(['hooks', 'setup', '--agent', 'codex', '--bin-dir', bin], { env });
    writeFileSync(
      join(codexHome, 'config.toml'),
      `notify = [${JSON.stringify(BIN)}, "notify-hook"]\nmodel = "o3"\n`,
    );
    const res = await run(['hooks', 'remove', '--agent', 'codex'], { env });
    expect(res.code).toBe(0);
    const toml = readFileSync(join(codexHome, 'config.toml'), 'utf8');
    expect(toml).not.toContain('notify-hook');
    expect(toml).toContain('model = "o3"');
    const hooks = JSON.parse(readFileSync(join(codexHome, 'hooks.json'), 'utf8'));
    expect(hooks.hooks).toBeUndefined();
  });

  it('preserves foreign Codex lifecycle hooks during setup and removal', async () => {
    const codexHome = tmp();
    const bin = tmp();
    const foreign = {
      hooks: {
        SessionStart: [
          { matcher: 'startup', hooks: [{ type: 'command', command: 'echo foreign' }] },
        ],
        Stop: [{ hooks: [{ type: 'command', command: 'echo stopped' }] }],
        PermissionRequest: [
          { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo approval' }] },
        ],
      },
    };
    writeFileSync(join(codexHome, 'hooks.json'), JSON.stringify(foreign));
    const env = { CODEX_HOME: codexHome };
    await run(['hooks', 'setup', '--agent', 'codex', '--bin-dir', bin], { env });
    let hooks = JSON.parse(readFileSync(join(codexHome, 'hooks.json'), 'utf8'));
    expect(hooks.hooks.SessionStart).toHaveLength(2);
    expect(hooks.hooks.Stop).toHaveLength(2);
    expect(hooks.hooks.PermissionRequest).toHaveLength(2);
    await run(['hooks', 'remove', '--agent', 'codex'], { env });
    hooks = JSON.parse(readFileSync(join(codexHome, 'hooks.json'), 'utf8'));
    expect(hooks).toEqual(foreign);
  });
});

describe('treeline hooks --agent parsing', () => {
  it('rejects an unknown agent kind', async () => {
    const res = await run(['hooks', 'setup', '--agent', 'clippy']);
    expect(res.code).toBe(2);
    expect(res.stderr).toContain('unknown agent');
  });

  it('aider reports its OSC fallback instead of pretending to wire hooks', async () => {
    const bin = tmp();
    const res = await run(['hooks', 'setup', '--agent', 'aider', '--bin-dir', bin]);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('no hook system');
    expect(res.stdout).toContain('OSC');
  });

  it('opencode reports that no adapter exists yet', async () => {
    const bin = tmp();
    const res = await run(['hooks', 'setup', '--agent', 'opencode', '--bin-dir', bin]);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('no adapter yet');
  });

  it('default (no --agent) still wires claude — existing muscle memory keeps working', async () => {
    const cfg = tmp();
    const bin = tmp();
    const res = await run(['hooks', 'setup', '--bin-dir', bin], {
      env: { CLAUDE_CONFIG_DIR: cfg },
    });
    expect(res.code).toBe(0);
    const settings = JSON.parse(readFileSync(join(cfg, 'settings.json'), 'utf8'));
    expect(settings.hooks.Stop[0].hooks[0].command).toContain('notify-hook');
  });
});

describe('treeline agent-session (client verb)', () => {
  it('sends an agent-session frame with kind, id and pane', async () => {
    const sock = join(tmp(), 's.sock');
    const { received } = stubServer(sock);
    const res = await run(
      ['agent-session', '--agent', 'opencode', 'ses_42', 'pane-9'],
      { env: { TREELINE_SOCK: sock } },
    );
    expect(res.code).toBe(0);
    expect(await received).toEqual({
      verb: 'agent-session',
      args: { paneId: 'pane-9', sessionId: 'ses_42', agent: 'opencode' },
    });
  });

  it('defaults the pane to $TREELINE_PANE_ID', async () => {
    const sock = join(tmp(), 's.sock');
    const { received } = stubServer(sock);
    await run(['agent-session', '--agent', 'aider', 'sess-1'], {
      env: { TREELINE_SOCK: sock, TREELINE_PANE_ID: 'pane-env' },
    });
    expect((await received).args).toEqual({
      paneId: 'pane-env',
      sessionId: 'sess-1',
      agent: 'aider',
    });
  });

  it('fails (exit 2) without --agent', async () => {
    const res = await run(['agent-session', 'sess-1', 'pane-1']);
    expect(res.code).toBe(2);
    expect(res.stderr).toContain('--agent');
  });
});

describe('treeline notify-hook (codex argv-payload style)', () => {
  it('accepts the payload as an argv argument and derives codex text', async () => {
    const sock = join(tmp(), 's.sock');
    const { received } = stubServer(sock);
    const res = await run(
      ['notify-hook', JSON.stringify({ type: 'agent-turn-complete' })],
      { env: { TREELINE_SOCK: sock, TREELINE_PANE_ID: 'pane-cx' } },
    );
    expect(res.code).toBe(0);
    expect((await received).args).toEqual({
      text: 'Codex finished responding',
      paneId: 'pane-cx',
    });
  });
});
