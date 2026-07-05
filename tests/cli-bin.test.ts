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

describe('treeline hooks setup --agent codex', () => {
  it('prepends a notify line into codex config.toml (CODEX_HOME honoured)', async () => {
    const codexHome = tmp();
    const bin = tmp();
    const res = await run(['hooks', 'setup', '--agent', 'codex', '--bin-dir', bin], {
      env: { CODEX_HOME: codexHome },
    });
    expect(res.code).toBe(0);
    const toml = readFileSync(join(codexHome, 'config.toml'), 'utf8');
    expect(toml).toContain('notify = [');
    expect(toml).toContain('notify-hook');
    expect(toml).toContain(BIN);
  });

  it('is idempotent (setup twice → one notify line)', async () => {
    const codexHome = tmp();
    const bin = tmp();
    const env = { CODEX_HOME: codexHome };
    await run(['hooks', 'setup', '--agent', 'codex', '--bin-dir', bin], { env });
    const second = await run(['hooks', 'setup', '--agent', 'codex', '--bin-dir', bin], { env });
    expect(second.code).toBe(0);
    expect(second.stdout).toContain('already present');
    const toml = readFileSync(join(codexHome, 'config.toml'), 'utf8');
    expect(toml.match(/notify = \[/g)).toHaveLength(1);
  });

  it('preserves existing top-level keys and tables (additive prepend)', async () => {
    const codexHome = tmp();
    const bin = tmp();
    writeFileSync(
      join(codexHome, 'config.toml'),
      'model = "o3"\n\n[shell_environment_policy]\ninherit = "all"\n',
    );
    await run(['hooks', 'setup', '--agent', 'codex', '--bin-dir', bin], {
      env: { CODEX_HOME: codexHome },
    });
    const toml = readFileSync(join(codexHome, 'config.toml'), 'utf8');
    // Our line comes first (top-level keys must precede any [table]) and
    // everything the user had is untouched.
    expect(toml.startsWith('notify = [')).toBe(true);
    expect(toml).toContain('model = "o3"');
    expect(toml).toContain('[shell_environment_policy]');
  });

  it("refuses to overwrite a foreign notify key (fail, don't clobber)", async () => {
    const codexHome = tmp();
    const bin = tmp();
    writeFileSync(join(codexHome, 'config.toml'), 'notify = ["notify-send", "Codex"]\n');
    const res = await run(['hooks', 'setup', '--agent', 'codex', '--bin-dir', bin], {
      env: { CODEX_HOME: codexHome },
    });
    expect(res.code).toBe(2);
    expect(res.stderr).toContain('already sets');
    // The user's wiring is untouched.
    expect(readFileSync(join(codexHome, 'config.toml'), 'utf8')).toBe(
      'notify = ["notify-send", "Codex"]\n',
    );
  });

  it('hooks remove --agent codex strips only our line', async () => {
    const codexHome = tmp();
    const bin = tmp();
    writeFileSync(join(codexHome, 'config.toml'), 'model = "o3"\n');
    const env = { CODEX_HOME: codexHome };
    await run(['hooks', 'setup', '--agent', 'codex', '--bin-dir', bin], { env });
    const res = await run(['hooks', 'remove', '--agent', 'codex'], { env });
    expect(res.code).toBe(0);
    const toml = readFileSync(join(codexHome, 'config.toml'), 'utf8');
    expect(toml).not.toContain('notify-hook');
    expect(toml).toContain('model = "o3"');
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
      text: 'codex finished responding',
      paneId: 'pane-cx',
    });
  });
});
