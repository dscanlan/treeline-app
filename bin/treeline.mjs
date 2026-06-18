#!/usr/bin/env node
// treeline — scriptable CLI for the treeline-app desktop app.
//
// A thin client: connects to the running app's unix domain socket, sends one
// newline-delimited-JSON command, prints the reply, and exits. The app's main
// process is the server (src/main/cli-server.ts). Kept dependency-free and
// self-contained so it can be symlinked onto PATH without a build step.
//
// Usage:
//   treeline ping
//   treeline repos
//   treeline worktrees <repo>
//   treeline open <repo> [branch]
//   treeline send <text...>            keystrokes to the focused terminal
//   treeline notify <text...>
//   treeline browser navigate <url> [--wait]  open the pane at <url> (--wait: until loaded)
//   treeline browser eval <js...>      run JS in the pane, print the result (local origins only)
//   treeline browser screenshot [path] capture the pane (PNG file at path, else data URL)
//   treeline browser snapshot          compact accessibility tree of the page
//   treeline browser query <selector>  inspect the first match of a CSS selector
//   treeline browser click <selector>  synthetic-click the element (local origins only)
//   treeline browser fill <selector> <text...>  type into the element (local origins only)
//   treeline hooks setup [--bin-dir D] wire Claude Code Stop/Notification hooks → in-app rings
//   treeline hooks remove
//
// Socket: $TREELINE_SOCK, else the app's userData dir + /cli.sock.

import { connect } from 'node:net';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';

const SELF = fileURLToPath(import.meta.url);
// Stable, Node-free entrypoint to invoke. When launched via the app-generated
// shim (a downloaded build), TREELINE_CLI_BIN is the shim path — prefer it for
// hook commands and the PATH symlink so they survive app updates and don't
// require a system `node`. Falls back to this script in a source checkout.
const ENTRY = process.env.TREELINE_CLI_BIN || SELF;

function socketPath() {
  if (process.env.TREELINE_SOCK) return process.env.TREELINE_SOCK;
  const home = homedir();
  const dir =
    process.platform === 'darwin'
      ? join(home, 'Library', 'Application Support', 'treeline-app')
      : process.platform === 'win32'
        ? join(process.env.APPDATA || join(home, 'AppData', 'Roaming'), 'treeline-app')
        : join(process.env.XDG_CONFIG_HOME || join(home, '.config'), 'treeline-app');
  return join(dir, 'cli.sock');
}

const USAGE = `treeline — drive the running treeline-app
  treeline ping
  treeline repos
  treeline worktrees <repo>
  treeline open <repo> [branch]
  treeline send <text...>            keystrokes to the focused terminal
  treeline notify <text...>
  treeline browser navigate <url> [--wait]  open the pane at <url> (--wait: until loaded)
  treeline browser eval <js...>      run JS in the pane, print the result (local origins only)
  treeline browser screenshot [path] capture the pane (PNG file at path, else data URL)
  treeline browser snapshot          compact accessibility tree of the page
  treeline browser query <selector>  inspect the first match of a CSS selector
  treeline browser click <selector>  synthetic-click the element (local origins only)
  treeline browser fill <selector> <text...>  type into the element (local origins only)
  treeline hooks setup [--bin-dir D] wire Claude Code Stop/Notification hooks → in-app rings
  treeline hooks remove`;

/** Decode the common backslash escapes so \`send "npm test\\n"\` runs the line. */
function unescape(s) {
  return s.replace(/\\([nrt\\])/g, (_, c) => ({ n: '\n', r: '\r', t: '\t', '\\': '\\' })[c]);
}

function buildRequest(argv) {
  const [verb, ...rest] = argv;
  switch (verb) {
    case 'ping':
    case 'repos':
      return { verb };
    case 'worktrees':
      if (!rest[0]) fail('worktrees requires a <repo>');
      return { verb, args: { repo: rest[0] } };
    case 'open':
      if (!rest[0]) fail('open requires a <repo> [branch]');
      return { verb, args: { repo: rest[0], ...(rest[1] ? { branch: rest[1] } : {}) } };
    case 'send': {
      const text = rest.join(' ');
      if (!text) fail('send requires <text>');
      return { verb, args: { text: unescape(text) } };
    }
    case 'notify': {
      const text = rest.join(' ').trim();
      if (!text) fail('notify requires <text>');
      return { verb, args: { text } };
    }
    case 'browser': {
      const action = rest[0];
      if (action === 'navigate') {
        const args = rest.slice(1);
        const wait = args.includes('--wait');
        const url = args.find((a) => a !== '--wait');
        if (!url) fail('browser navigate requires a <url>');
        return { verb, args: { action: 'navigate', url, ...(wait ? { wait: true } : {}) } };
      }
      if (action === 'eval') {
        const code = rest.slice(1).join(' ');
        if (!code) fail('browser eval requires <js>');
        return { verb, args: { action: 'eval', code } };
      }
      if (action === 'screenshot') {
        // Resolve the optional out-path against the CALLER's cwd here (the app's
        // main process, which writes the file, has a different cwd).
        const target = rest[1];
        return {
          verb,
          args: target
            ? { action: 'screenshot', path: resolve(process.cwd(), target) }
            : { action: 'screenshot' },
        };
      }
      if (action === 'snapshot') {
        return { verb, args: { action: 'snapshot' } };
      }
      if (action === 'query') {
        const selector = rest[1];
        if (!selector) fail('browser query requires a <selector>');
        return { verb, args: { action: 'query', selector } };
      }
      if (action === 'click') {
        const selector = rest[1];
        if (!selector) fail('browser click requires a <selector>');
        return { verb, args: { action: 'click', selector } };
      }
      if (action === 'fill') {
        const selector = rest[1];
        const text = rest.slice(2).join(' ');
        if (!selector) fail('browser fill requires a <selector> and <text>');
        return { verb, args: { action: 'fill', selector, text: unescape(text) } };
      }
      fail(
        `browser: unknown action "${action ?? ''}" (expected navigate|eval|screenshot|snapshot|query|click|fill)`,
      );
      break;
    }
    default:
      fail(verb ? `unknown command: ${verb}` : 'no command given');
  }
}

function fail(msg) {
  process.stderr.write(`treeline: ${msg}\n\n${USAGE}\n`);
  process.exit(2);
}

function send(req) {
  const path = socketPath();
  const sock = connect(path);
  let buf = '';
  sock.setEncoding('utf8');
  sock.on('connect', () => sock.write(JSON.stringify(req) + '\n'));
  sock.on('data', (chunk) => {
    buf += chunk;
    const nl = buf.indexOf('\n');
    if (nl === -1) return;
    sock.end();
    let res;
    try {
      res = JSON.parse(buf.slice(0, nl));
    } catch {
      process.stderr.write('treeline: malformed reply from app\n');
      process.exit(1);
    }
    if (res.ok) {
      if (res.data !== undefined) process.stdout.write(JSON.stringify(res.data, null, 2) + '\n');
      process.exit(0);
    } else {
      process.stderr.write(`treeline: ${res.error}\n`);
      process.exit(1);
    }
  });
  sock.on('error', (err) => {
    const hint =
      err && err.code === 'ENOENT'
        ? 'is treeline-app running? (no socket at ' + path + ')'
        : err.message;
    process.stderr.write(`treeline: cannot reach app — ${hint}\n`);
    process.exit(1);
  });
}

// ----------------------------------------------------------------------------
// Claude Code hook integration
// ----------------------------------------------------------------------------

/** Where Claude Code keeps settings.json (honours CLAUDE_CONFIG_DIR like the app does). */
function claudeConfigDir() {
  return process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
}

/** The two events worth a desktop ping: Claude finishing, and Claude asking for input. */
const HOOK_EVENTS = ['Stop', 'Notification'];
const HOOK_TAG = 'notify-hook'; // substring used to detect/remove our own hooks

function readSettings(settingsPath) {
  if (!existsSync(settingsPath)) return {};
  try {
    return JSON.parse(readFileSync(settingsPath, 'utf8'));
  } catch {
    fail(`could not parse ${settingsPath}; fix or move it, then retry`);
  }
}

function writeSettings(settingsPath, settings) {
  mkdirSync(dirname(settingsPath), { recursive: true });
  const tmp = settingsPath + '.tmp';
  writeFileSync(tmp, JSON.stringify(settings, null, 2) + '\n');
  renameSync(tmp, settingsPath); // atomic
}

function hooksSetup(opts) {
  const settingsPath = join(claudeConfigDir(), 'settings.json');
  const settings = readSettings(settingsPath);
  settings.hooks ??= {};

  // Point the hook at the CLI by ABSOLUTE path so it works regardless of
  // whether the symlink dir made it onto PATH.
  const command = `${ENTRY} ${HOOK_TAG}`;
  let added = 0;
  for (const event of HOOK_EVENTS) {
    const groups = (settings.hooks[event] ??= []);
    const already = groups.some((g) =>
      (g.hooks || []).some((h) => typeof h.command === 'string' && h.command.includes(HOOK_TAG)),
    );
    if (already) continue;
    groups.push({ hooks: [{ type: 'command', command }] });
    added++;
  }
  writeSettings(settingsPath, settings);

  console.log(
    `hooks: ${added > 0 ? `added ${added}` : 'already present'} (${HOOK_EVENTS.join(', ')}) in ${settingsPath}`,
  );
  console.log(`  command: ${command}`);

  // Best-effort: put `treeline` on PATH for interactive use.
  const binDir = opts.binDir || join(homedir(), '.local', 'bin');
  try {
    mkdirSync(binDir, { recursive: true });
    const link = join(binDir, 'treeline');
    try {
      lstatSync(link);
      rmSync(link, { force: true });
    } catch {
      /* nothing to replace */
    }
    symlinkSync(ENTRY, link);
    console.log(`  linked: ${link} -> ${ENTRY}`);
    const onPath = (process.env.PATH || '').split(':').includes(binDir);
    if (!onPath) console.log(`  note: ${binDir} is not on your PATH (add it to run \`treeline\` directly)`);
  } catch (e) {
    console.log(`  note: could not symlink into ${binDir}: ${e.message}`);
  }

  console.log('Run /hooks in Claude Code (or restart it) to load the new hooks.');
  process.exit(0);
}

function hooksRemove() {
  const settingsPath = join(claudeConfigDir(), 'settings.json');
  const settings = readSettings(settingsPath);
  let removed = 0;
  for (const event of HOOK_EVENTS) {
    const groups = settings.hooks?.[event];
    if (!Array.isArray(groups)) continue;
    const kept = groups.filter((g) => {
      const ours = (g.hooks || []).some(
        (h) => typeof h.command === 'string' && h.command.includes(HOOK_TAG),
      );
      if (ours) removed++;
      return !ours;
    });
    if (kept.length > 0) settings.hooks[event] = kept;
    else delete settings.hooks[event];
  }
  writeSettings(settingsPath, settings);
  console.log(`hooks: removed ${removed} from ${settingsPath}`);
  process.exit(0);
}

function hooksCmd(argv) {
  const sub = argv[0];
  if (sub === 'setup') {
    const i = argv.indexOf('--bin-dir');
    const binDir = i !== -1 ? argv[i + 1] : undefined;
    return hooksSetup({ binDir });
  }
  if (sub === 'remove') return hooksRemove();
  fail(`hooks: unknown subcommand "${sub ?? ''}" (expected setup|remove)`);
}

/**
 * Internal verb wired into Claude Code settings.json. Reads the hook's JSON
 * payload from stdin, derives a message + the agent's cwd, and reports it to the
 * running app over the socket as a `notify` with `cwd`.
 *
 * Why the socket and not an OSC escape: Claude Code runs hooks *without a
 * controlling terminal* (opening `/dev/tty` fails with ENXIO), so we can't
 * inject an OSC 9 into the pane the way an interactive shell could. The app
 * instead maps the reported cwd → the PTY(s) running there and lights that
 * pane's in-app ring/badge (plus a native toast when the window is unfocused).
 * Direct OSC 9/99/777 from a terminal still works too — that path is handled by
 * PtyManager's output scanner and is what non-Claude agents can use.
 *
 * CRITICAL: this must NEVER fail the hook — it always exits 0, even if the app
 * is down, so it can't disrupt Claude Code.
 */
function notifyHook() {
  let done = false;
  const exit0 = () => {
    if (!done) {
      done = true;
      process.exit(0);
    }
  };
  // Hard ceiling so a stuck stdin never hangs a Claude Code turn.
  setTimeout(exit0, 2000);

  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => (input += d));
  process.stdin.on('end', () => {
    let text = 'Claude Code';
    let cwd;
    try {
      const e = JSON.parse(input || '{}');
      if (typeof e.cwd === 'string' && e.cwd) cwd = e.cwd;
      if (typeof e.message === 'string' && e.message) text = e.message;
      else if (e.hook_event_name === 'Stop') text = 'Claude finished responding';
      else if (e.hook_event_name === 'Notification') text = 'Claude needs your attention';
      if (cwd) text += ` — ${basename(cwd)}`;
    } catch {
      /* fall back to the default text */
    }
    // Claude Code runs hooks WITHOUT a controlling terminal (/dev/tty is ENXIO),
    // so we can't emit an OSC escape into the pane. Instead tell the app over the
    // socket. The hook inherits TREELINE_PANE_ID from the shell treeline spawned
    // it in, so prefer that — it identifies the EXACT pane, where cwd can't tell
    // two tabs in the same directory apart. cwd is still sent as a fallback for
    // shells treeline didn't spawn (no pane id). Fire-and-forget; never fail the
    // hook.
    const paneId = process.env.TREELINE_PANE_ID || undefined;
    try {
      const sock = connect(socketPath());
      sock.on('connect', () =>
        sock.end(
          JSON.stringify({
            verb: 'notify',
            args: { text, ...(cwd ? { cwd } : {}), ...(paneId ? { paneId } : {}) },
          }) + '\n',
        ),
      );
      sock.on('data', exit0);
      sock.on('close', exit0);
      sock.on('error', exit0);
    } catch {
      exit0();
    }
  });
}

// ----------------------------------------------------------------------------

const args = process.argv.slice(2);
const cmd = args[0];
if (!cmd || cmd === '-h' || cmd === '--help') {
  process.stdout.write(USAGE + '\n');
  process.exit(0);
}
if (cmd === 'hooks') hooksCmd(args.slice(1));
else if (cmd === HOOK_TAG) notifyHook();
else send(buildRequest(args));
