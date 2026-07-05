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
//   treeline claude-session <session-id> [pane-id]  report the Claude session in a pane
//   treeline agent-session --agent <kind> <session-id> [pane-id]  same, for any agent kind
//   treeline hooks setup [--agent <kind>|--all] [--bin-dir D]
//                                      wire an agent's hooks → in-app rings + session pinning
//   treeline hooks remove [--agent <kind>|--all]
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
  treeline claude-session <session-id> [pane-id]  report the Claude session in a pane
                                     (pane defaults to $TREELINE_PANE_ID)
  treeline agent-session --agent <kind> <session-id> [pane-id]  same, for any agent kind
  treeline hooks setup [--agent <kind>|--all] [--bin-dir D]
                                     wire an agent's hooks → in-app rings + session pinning
                                     (kinds: claude (default), codex; opencode/aider: see docs)
  treeline hooks remove [--agent <kind>|--all]`;

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
    case 'claude-session': {
      const sessionId = rest[0];
      const paneId = rest[1] || process.env.TREELINE_PANE_ID;
      if (!sessionId) fail('claude-session requires a <session-id>');
      if (!paneId) fail('claude-session requires a [pane-id] (or $TREELINE_PANE_ID)');
      return { verb, args: { paneId, sessionId } };
    }
    case 'agent-session': {
      // Generalised session report: `agent-session --agent <kind> <id> [pane]`.
      // The `claude-session` verb above stays as the claude-only alias so hooks
      // wired on users' machines before this verb existed keep working.
      const i = rest.indexOf('--agent');
      const agent = i !== -1 ? rest[i + 1] : undefined;
      const positional = rest.filter((a, j) => a !== '--agent' && j !== i + 1);
      const sessionId = positional[0];
      const paneId = positional[1] || process.env.TREELINE_PANE_ID;
      if (!agent) fail('agent-session requires --agent <kind>');
      if (!sessionId) fail('agent-session requires a <session-id>');
      if (!paneId) fail('agent-session requires a [pane-id] (or $TREELINE_PANE_ID)');
      return { verb, args: { paneId, sessionId, agent } };
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
// Per-agent hook integration
// ----------------------------------------------------------------------------
// Each agent's wiring mechanism is owned by an adapter in HOOK_ADAPTERS below
// (this file is deliberately dependency-free and Node-only, so the adapters
// live inline — it cannot import from src/). An agent with a null adapter has
// no hook system we can wire; the OSC 9/99/777 escape path in the app still
// works for anything that emits it into its pane.

/** Where Claude Code keeps settings.json (honours CLAUDE_CONFIG_DIR like the app does). */
function claudeConfigDir() {
  return process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
}

/** Where codex keeps config.toml (honours CODEX_HOME, codex's own env var). */
function codexConfigPath() {
  return join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'config.toml');
}

// Tags double as the hook subcommand AND the substring used to detect/remove
// our own entries in agent config files.
const HOOK_TAG = 'notify-hook';
const SESSION_HOOK_TAG = 'claude-session-hook';

/**
 * Every Claude Code hook we wire: Claude finishing + Claude asking for input
 * (desktop pings), and each session's startup (reports the pane's session id
 * so treeline's session-restore resumes the exact conversation per pane).
 * SessionStart also fires on --resume, /clear, and compaction bridges, so the
 * app's pane → session map stays current as the id changes.
 */
const HOOK_WIRING = [
  { event: 'Stop', tag: HOOK_TAG },
  { event: 'Notification', tag: HOOK_TAG },
  { event: 'SessionStart', tag: SESSION_HOOK_TAG },
];
const HOOK_EVENTS = [...new Set(HOOK_WIRING.map((w) => w.event))];

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

/** Atomic small-file write (tmp+rename), creating the parent dir. */
function writeAtomic(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + '.tmp';
  writeFileSync(tmp, contents);
  renameSync(tmp, path);
}

/**
 * Per-agent hook adapters. `setup()`/`remove()` print their own summary lines
 * and return true when they changed anything; `detect()` says whether the
 * agent looks installed (drives `--all`). A null adapter documents itself in
 * `hooksSetup`'s summary instead of pretending: aider has no hook system at
 * all (attention still works if something in the pane emits an OSC escape),
 * and opencode's plugin API hasn't been verified against a real install yet.
 */
const HOOK_ADAPTERS = {
  claude: {
    detect: () => existsSync(claudeConfigDir()),
    setup() {
      const settingsPath = join(claudeConfigDir(), 'settings.json');
      const settings = readSettings(settingsPath);
      settings.hooks ??= {};

      // Point the hooks at the CLI by ABSOLUTE path so they work regardless of
      // whether the symlink dir made it onto PATH. Re-running setup is additive:
      // an install predating a newly-wired event just gains the missing entry.
      let added = 0;
      for (const { event, tag } of HOOK_WIRING) {
        const groups = (settings.hooks[event] ??= []);
        const already = groups.some((g) =>
          (g.hooks || []).some((h) => typeof h.command === 'string' && h.command.includes(tag)),
        );
        if (already) continue;
        groups.push({ hooks: [{ type: 'command', command: `${ENTRY} ${tag}` }] });
        added++;
      }
      writeSettings(settingsPath, settings);

      console.log(
        `claude: ${added > 0 ? `added ${added}` : 'already present'} (${HOOK_EVENTS.join(', ')}) in ${settingsPath}`,
      );
      for (const { event, tag } of HOOK_WIRING) console.log(`  ${event}: ${ENTRY} ${tag}`);
      console.log('  Run /hooks in Claude Code (or restart it) to load the new hooks.');
      return added > 0;
    },
    remove() {
      const settingsPath = join(claudeConfigDir(), 'settings.json');
      const settings = readSettings(settingsPath);
      const tags = HOOK_WIRING.map((w) => w.tag);
      let removed = 0;
      for (const event of HOOK_EVENTS) {
        const groups = settings.hooks?.[event];
        if (!Array.isArray(groups)) continue;
        const kept = groups.filter((g) => {
          const ours = (g.hooks || []).some(
            (h) => typeof h.command === 'string' && tags.some((t) => h.command.includes(t)),
          );
          if (ours) removed++;
          return !ours;
        });
        if (kept.length > 0) settings.hooks[event] = kept;
        else delete settings.hooks[event];
      }
      writeSettings(settingsPath, settings);
      console.log(`claude: removed ${removed} from ${settingsPath}`);
      return removed > 0;
    },
  },

  codex: {
    detect: () => existsSync(dirname(codexConfigPath())),
    setup() {
      // codex's documented notification wiring is the top-level `notify` key
      // in config.toml: an argv array codex invokes with a JSON payload as the
      // final argument (currently fired on agent-turn-complete). codex has no
      // session-start hook, so there is no per-pane id pinning for it — resume
      // relies on the session-store side instead.
      const configPath = codexConfigPath();
      const current = existsSync(configPath) ? readFileSync(configPath, 'utf8') : '';
      if (current.includes(HOOK_TAG)) {
        console.log(`codex: already present in ${configPath}`);
        return false;
      }
      if (/^\s*notify\s*=/m.test(current)) {
        fail(
          `codex: ${configPath} already sets \`notify\` — merge \`${ENTRY} ${HOOK_TAG}\` into it manually, then retry`,
        );
      }
      // Top-level keys must precede any [table] section, so prepend.
      const line = `notify = [${JSON.stringify(ENTRY)}, ${JSON.stringify(HOOK_TAG)}]\n`;
      writeAtomic(configPath, line + current);
      console.log(`codex: added notify → ${ENTRY} ${HOOK_TAG} in ${configPath}`);
      return true;
    },
    remove() {
      const configPath = codexConfigPath();
      if (!existsSync(configPath)) {
        console.log('codex: nothing to remove');
        return false;
      }
      const current = readFileSync(configPath, 'utf8');
      const kept = current
        .split('\n')
        .filter((l) => !(/^\s*notify\s*=/.test(l) && l.includes(HOOK_TAG)))
        .join('\n');
      if (kept === current) {
        console.log('codex: nothing to remove');
        return false;
      }
      writeAtomic(configPath, kept);
      console.log(`codex: removed notify wiring from ${configPath}`);
      return true;
    },
  },

  // opencode's plugin API hasn't been verified against a real install — no
  // adapter until it is (wire `treeline notify` / `treeline agent-session
  // --agent opencode` from a plugin manually if you need it today).
  opencode: null,

  // aider has no hook system at all. Attention still works via OSC 9/99/777
  // escapes if something in the pane emits them.
  aider: null,
};

const ADAPTER_KINDS = Object.keys(HOOK_ADAPTERS);

/** Resolve `--agent <kind>` / `--all` to the list of kinds to act on. */
function hookAgentsFromArgs(argv) {
  if (argv.includes('--all')) {
    return ADAPTER_KINDS.filter((k) => HOOK_ADAPTERS[k]?.detect());
  }
  const i = argv.indexOf('--agent');
  const kind = i !== -1 ? argv[i + 1] : 'claude'; // default: today's behaviour
  if (!ADAPTER_KINDS.includes(kind)) {
    fail(`hooks: unknown agent "${kind ?? ''}" (expected ${ADAPTER_KINDS.join('|')})`);
  }
  return [kind];
}

function hooksSetup(opts) {
  for (const kind of opts.agents) {
    const adapter = HOOK_ADAPTERS[kind];
    if (!adapter) {
      console.log(
        kind === 'aider'
          ? 'aider: no hook system — attention works via OSC escapes if your setup emits them'
          : `${kind}: no adapter yet (plugin API unverified) — see docs/CLI.md for manual wiring`,
      );
      continue;
    }
    adapter.setup();
  }

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

  process.exit(0);
}

function hooksRemove(opts) {
  for (const kind of opts.agents) {
    const adapter = HOOK_ADAPTERS[kind];
    if (!adapter) {
      console.log(`${kind}: nothing wired`);
      continue;
    }
    adapter.remove();
  }
  process.exit(0);
}

function hooksCmd(argv) {
  const sub = argv[0];
  const rest = argv.slice(1);
  if (sub === 'setup') {
    const i = rest.indexOf('--bin-dir');
    const binDir = i !== -1 ? rest[i + 1] : undefined;
    return hooksSetup({ binDir, agents: hookAgentsFromArgs(rest) });
  }
  if (sub === 'remove') return hooksRemove({ agents: hookAgentsFromArgs(rest) });
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
function notifyHook(argvPayload) {
  let done = false;
  const exit0 = () => {
    if (!done) {
      done = true;
      process.exit(0);
    }
  };
  // Hard ceiling so a stuck stdin never hangs an agent's turn.
  setTimeout(exit0, 2000);

  const report = (input) => {
    let text = 'Agent needs your attention';
    let cwd;
    try {
      const e = JSON.parse(input || '{}');
      if (typeof e.cwd === 'string' && e.cwd) cwd = e.cwd;
      if (typeof e.message === 'string' && e.message) text = e.message;
      else if (e.hook_event_name === 'Stop') text = 'Claude finished responding';
      else if (e.hook_event_name === 'Notification') text = 'Claude needs your attention';
      else if (e.type === 'agent-turn-complete') text = 'codex finished responding';
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
  };

  if (argvPayload !== undefined) {
    // codex style: the JSON payload arrives as the final argv argument (its
    // config.toml `notify` array is exec'd with the payload appended), not on
    // stdin — report it directly.
    report(argvPayload);
    return;
  }
  // Claude Code style: the payload arrives on stdin.
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => (input += d));
  process.stdin.on('end', () => report(input));
}

/**
 * Internal verb wired as a Claude Code SessionStart hook. Reads the hook's
 * JSON payload from stdin and reports {paneId → session_id} to the running app
 * over the socket, so treeline knows which conversation each pane is actually
 * running — session-restore then pins the exact id per pane instead of
 * guessing "newest transcript for the cwd" (wrong whenever two panes share a
 * directory, or anything else wrote a transcript there more recently).
 *
 * SessionStart fires on startup, --resume, /clear, and compaction bridges, so
 * every id change re-reports itself — including right after a restore, which
 * makes the mapping self-healing across restarts. No-op (exit 0) when Claude
 * isn't running inside a treeline pane (no TREELINE_PANE_ID), when the payload
 * has no session id, or when the app is down: like notifyHook, this must NEVER
 * fail the hook or hang a Claude Code turn.
 */
function claudeSessionHook() {
  let done = false;
  const exit0 = () => {
    if (!done) {
      done = true;
      process.exit(0);
    }
  };
  setTimeout(exit0, 2000);

  const paneId = process.env.TREELINE_PANE_ID;
  if (!paneId) exit0();

  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => (input += d));
  process.stdin.on('end', () => {
    let sessionId;
    try {
      const e = JSON.parse(input || '{}');
      if (typeof e.session_id === 'string' && e.session_id) sessionId = e.session_id;
    } catch {
      /* malformed payload — nothing to report */
    }
    if (!sessionId) return exit0();
    try {
      const sock = connect(socketPath());
      sock.on('connect', () =>
        sock.end(JSON.stringify({ verb: 'claude-session', args: { paneId, sessionId } }) + '\n'),
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
else if (cmd === HOOK_TAG) notifyHook(args[1]);
else if (cmd === SESSION_HOOK_TAG) claudeSessionHook();
else send(buildRequest(args));
