# Treeline CLI

The running app exposes a `treeline` CLI so scripts and agents — not just the
mouse — can drive it. It is a thin client: it connects to the app's local
socket, sends one command, prints the reply, and exits. Every verb routes
through the same services the GUI uses, so behaviour can't drift between mouse
and script.

> The CLI **requires the desktop app to be running** — it has no standalone
> mode. If the app is down, every verb fails with a "cannot reach app" error
> (see [Troubleshooting](#troubleshooting)).

---

## Installation

The CLI is a self-contained, dependency-free Node script
([`bin/treeline.mjs`](../bin/treeline.mjs)). The packaged `.app` ships it and
runs it via the app's own bundled Node — **so you don't need Node installed**,
and you don't need a source checkout. How you reach it depends on where you're
calling from.

### Inside the app's terminals — nothing to install

Every terminal Treeline spawns has `treeline` on its `PATH` automatically. The
app writes a small launcher at `<userData>/bin/treeline` on startup and prepends
that dir to each terminal's `PATH`. So an agent running in a Treeline tab can
just call it:

```bash
treeline ping
# { "ok": true, "app": "treeline", "version": "0.25.0" }
```

This is the common case — agents driving the app live in its terminals.

### Outside the app — install once

To use `treeline` from a terminal *not* spawned by Treeline (e.g. Terminal.app),
install it globally from the app menu:

> **Treeline → Install Command Line Tool…**

That symlinks the launcher into `/usr/local/bin/treeline`. If that dir isn't
writable, the dialog shows a copy-pasteable `sudo ln -sf …` command to finish it
by hand.

### From a source checkout (development)

Running from the repo (`npm run dev`), symlink the script onto your `PATH`:

```bash
ln -sf "$(pwd)/bin/treeline.mjs" ~/.local/bin/treeline   # from the repo root
# ensure ~/.local/bin is on your PATH
```

Or let `hooks setup` create the symlink for you (see
[Agent hooks](#agent-hooks)):

```bash
node bin/treeline.mjs hooks setup            # symlinks into ~/.local/bin by default
node bin/treeline.mjs hooks setup --bin-dir ~/bin   # … or a dir you choose
```

`hooks setup` warns if the chosen bin dir isn't on your `PATH`.

> `treeline`, `treeline -h`, and `treeline --help` all print usage and exit `0`.
> Every verb **requires the app to be running** (see [Troubleshooting](#troubleshooting)).

---

## How it works

```
treeline <verb> [args]  ──{verb,args}\n──▶  app main process (CliServer)
                        ◀──{ok,…}\n────────  same line back, then disconnect
```

- **Transport.** A user-scoped unix domain socket, `chmod 0600`, under the app's
  `userData` dir. On macOS that's
  `~/Library/Application Support/treeline-app/cli.sock`. It is never bound to a
  network interface — anyone who can reach the socket can drive your terminals,
  so it's owner-only by design.
- **Socket override.** Set `TREELINE_SOCK` to point the CLI (and the app) at a
  different socket path — useful for tests or a non-default profile.
- **Reply.** On success the CLI prints the `data` payload as pretty JSON and
  exits `0`. On an app-side error it prints `treeline: <error>` to stderr and
  exits `1`. On a client-side argument error it prints the message + usage to
  stderr and exits `2`.

---

## Commands

| Command | What it does |
| ------- | ------------ |
| `treeline ping` | Health check; returns app name + version. |
| `treeline repos` | List tracked repos (JSON). |
| `treeline worktrees <repo>` | List a repo's worktrees (JSON). |
| `treeline open <repo> [branch]` | Focus, or open, that worktree's terminal tab. |
| `treeline send <text…>` | Type keystrokes into the focused terminal. |
| `treeline notify <text…>` | Native desktop notification from the app. |
| `treeline claude-session <session-id> [pane-id]` | Report the Claude session running in a pane (pane defaults to `$TREELINE_PANE_ID`); normally sent by the `SessionStart` hook. |
| `treeline browser <action> …` | Drive the embedded browser pane (see below). |
| `treeline hooks setup [--agent K\|--all] [--bin-dir D]` | Wire an agent's hooks + symlink the CLI (default agent: claude). |
| `treeline hooks remove [--agent K\|--all]` | Remove the hook wiring this tool added for an agent. |
| `treeline agent-session --agent K <session-id> [pane-id]` | Report the session running in a pane, for any agent kind. |

### How `<repo>` is matched

`open` resolves a `<repo> [branch]` selector to a worktree path:

1. `<repo>` matches a tracked repo by **name** (`treeline-app`) **or** by
   **absolute repo path** (`/Users/me/code/treeline-app`).
2. Failing that, an absolute path that lies *inside* a tracked repo (e.g. a
   worktree directory) matches that repo.
3. **With a branch:** returns the repo's worktree on that branch (error if
   none).
4. **Without a branch:** if `<repo>` was an exact worktree path, that worktree;
   otherwise the repo's primary (non-bare) worktree.

> `treeline worktrees <repo>` matches **only** by exact name or exact repo
> path — not the inside-a-repo prefix rule that `open` uses.

### Quoting & escaping

- `send` and `browser fill` decode the escapes `\n`, `\r`, `\t`, and `\\`, so
  `treeline send 'npm test\n'` runs the line (the `\n` becomes a real Enter).
  Quote the argument so your shell doesn't eat the backslash.
- `send` accepts an empty/control-only string (e.g. send just a `\n` to press
  Enter, or a raw control char).
- `notify` joins all trailing words into one message and trims it.
- For `browser eval`, the JS is the joined trailing args; quote it so your shell
  passes it through intact: `treeline browser eval 'document.title'`.
- Selectors for `query`/`click`/`fill` are passed verbatim — quote any selector
  containing spaces or shell metacharacters.

---

## Browser verbs

Drive the [embedded browser pane](./USER_GUIDE.md#dev-servers--the-browser-pane)
so an agent can act on a change and verify the result. `navigate` opens/points the pane; the rest run against the page.

| Command | Returns (`data`) |
| ------- | ---------------- |
| `treeline browser navigate <url> [--wait]` | `{ "navigated": "<url>" }` |
| `treeline browser snapshot` | `{ "snapshot": "<accessibility tree>" }` |
| `treeline browser query <selector>` | `{ "element": <descriptor or null> }` |
| `treeline browser eval <js…>` | `{ "result": <value> }` |
| `treeline browser click <selector>` | click result |
| `treeline browser fill <selector> <text…>` | fill result |
| `treeline browser screenshot [path]` | `{ "screenshot": "data:…" }`, or `{ "saved": "<abs path>" }` if `path` given |

Notes:

- **URL normalization.** A bare host (`localhost:3000`, `example.com/path`) is
  assumed `http://`. A non-web scheme (`file:`, `javascript:`, `data:`, …) is
  refused with `not a navigable http(s) URL: <input>`.
- **`--wait`** resolves only once the page finishes loading, so a following
  `screenshot`/`snapshot` never captures a half-rendered frame.
- **`screenshot [path]`** resolves a relative `path` against *your* shell's cwd
  (not the app's), and writes a PNG there; with no path it returns a data URL.
- **Local-origins-only gate.** `eval`, `click`, and `fill` are refused unless
  the pane is on a local origin (`localhost` / `127.0.0.1` / `[::1]`). They fail
  with `scripting blocked: non-local origin (<host>)`. `navigate`, `snapshot`,
  `query`, and `screenshot` work against any page.

A typical agent loop:

```bash
treeline browser navigate http://localhost:5173 --wait
treeline browser snapshot                       # orient: roles + names
treeline browser fill  "#email" "agent@treeline.dev"
treeline browser click "#save"
treeline browser screenshot ./after.png         # verify
```

---

## Agent hooks

`treeline hooks setup [--agent <kind>]` wires an agent's attention
notifications (and, where the agent supports it, per-pane session pinning) and
installs the CLI symlink, in one step. Each agent's wiring mechanism is owned
by an adapter; the support matrix:

| Agent | Notifications | Session pinning | Mechanism |
|---|---|---|---|
| `claude` (default) | ✅ | ✅ | `settings.json` hook entries (below) |
| `codex` | ✅ | — (no session-start hook; resume relies on the session store) | top-level `notify` key in `config.toml` (honours `CODEX_HOME`) |
| `opencode` | manual | manual | no adapter yet — its plugin API is unverified; a plugin can call `treeline notify` / `treeline agent-session --agent opencode` |
| `aider` | OSC fallback | — | no hook system; anything that emits OSC 9/99/777 in the pane still lights it |

`--all` wires every agent whose config directory is detected. `hooks remove
[--agent <kind>|--all]` strips exactly what the adapter added — a foreign
`notify` key in codex's `config.toml` is never overwritten (setup fails with
instructions instead).

### Claude Code (the `claude` adapter)

For Claude Code, `hooks setup` does the following:

- Adds `Stop` and `Notification` hook entries to Claude Code's `settings.json`
  that call this script's internal `notify-hook`. When Claude finishes or asks
  for input, the hook reports to the running app over the socket. Every shell
  treeline spawns is tagged with a `TREELINE_PANE_ID` env var, which the hook
  inherits and sends back, so the app lights the **exact pane** the agent is in.
  The cwd is also sent as a fallback (for shells treeline didn't spawn, or hook
  firings that lost the env var), but it's only used when it resolves to a single
  pane — cwd alone can't tell two tabs in the same directory apart, so an ambiguous
  cwd falls back to a window-level desktop notification instead of lighting the
  wrong tab. It lights that pane's
  [waiting indicators](./USER_GUIDE.md#knowing-when-an-agent-needs-you)
  — the magenta tab, the sidebar unread dot, and the pane ring — plus a native
  desktop notification when the window is in the background. The hook is wired by
  **absolute path**, so it works even if the symlink dir isn't on `PATH`, and it
  **never blocks Claude** — if the app is down it exits cleanly.
  - Why the socket and not a terminal escape code: Claude Code runs hooks
    *without a controlling terminal*, so the hook can't emit an OSC sequence into
    the pane the way a normal shell command can. (Tools that *do* run in the
    terminal can emit **OSC&nbsp;9 / 99 / 777** directly and treeline will pick
    them up with no hook at all.)
  - In a **packaged build**, the hook points at the app's launcher
    (`<userData>/bin/treeline`, via `TREELINE_CLI_BIN`) rather than the raw
    `.mjs`, so it runs through the app's bundled Node (no system Node needed)
    and keeps working across app updates. From a **source checkout** it points
    at `bin/treeline.mjs` directly.
- Adds a `SessionStart` hook entry calling the internal `claude-session-hook`.
  Every time a Claude session starts in a treeline pane — a fresh `claude`, a
  `--resume`, a `/clear`, or a compaction bridge — the hook reports that pane's
  **actual session id** (`TREELINE_PANE_ID` → `session_id`) to the app. The
  [session save/restore](./USER_GUIDE.md) path pins that exact id per pane, so
  after a restart every restored pane resumes **its own** conversation — even
  two tabs running different Claude sessions in the same directory. Without the
  hook, restore falls back to the newest transcript for the pane's directory,
  which can't tell such tabs apart. Like `notify-hook`, it never blocks Claude
  and exits cleanly when the app is down or the pane isn't treeline's.
- Symlinks `treeline` into `~/.local/bin` (override with `--bin-dir <dir>`),
  replacing any existing link there.
- After running it, run `/hooks` in Claude Code (or restart it) to load the new
  hooks.

`settings.json` location honours **`CLAUDE_CONFIG_DIR`** (falling back to
`~/.claude`), matching the app.

### Removing hooks vs. removing the CLI

These are **separate**:

- `treeline hooks remove` strips only the hook entries this tool added (it
  matches the `notify-hook` / `claude-session-hook` tags; for codex, the
  `notify` line containing `notify-hook`). It does **not** touch any symlink.
- To uninstall the global CLI, delete the symlink: `rm /usr/local/bin/treeline`
  (menu install) or `rm ~/.local/bin/treeline` (`hooks setup` / manual). The
  auto-injected launcher under `<userData>/bin` only exists inside the app's own
  terminals and is rewritten each launch — nothing to uninstall there.

> The **in-app** waiting indicators (tab, sidebar dot, pane ring) work
> everywhere, including `npm run dev`. The extra **native macOS notification**
> is delivered only from a **signed packaged build** — the unsigned `npm run dev`
> binary is denied by the OS. The socket, `open`, and `send` work in dev
> regardless.

---

## JSON output shapes

The CLI pretty-prints the response `data` payload. Shapes:

**`ping`**

```json
{ "ok": true, "app": "treeline", "version": "0.25.0" }
```

**`repos`** — array of `Repo`:

```json
[
  {
    "path": "/Users/me/code/treeline-app",
    "name": "treeline-app",
    "addedAt": 1718700000000
  }
]
```

**`worktrees <repo>`** — array of `Worktree`:

```json
[
  {
    "path": "/Users/me/code/treeline-app",
    "branch": "main",
    "commit": "d5fed3e",
    "isBare": false,
    "isDirty": true,
    "isCurrent": false,
    "isClaude": false
  }
]
```

`branch` is the branch name, or `"(detached)"` / `"(bare)"`. `commit` is a
7-char short SHA.

**`open`** → `{ "opened": "<worktree path>" }`
**`send`** → `{ "sent": <chars typed> }`
**`notify`** → no `data` (prints nothing on success).

---

## Troubleshooting

| Message | Cause / fix |
| ------- | ----------- |
| `cannot reach app — is treeline-app running? (no socket at …)` | The app isn't running, or `TREELINE_SOCK` points at the wrong path. Launch the app. |
| `cannot reach app — <error>` | The socket exists but the connection failed (e.g. permissions). |
| `unknown repo: <repo>` | `<repo>` didn't match a tracked repo by name/path. Run `treeline repos` to see valid names. |
| `no worktree on branch "<b>" in <repo>` | No worktree is checked out on that branch in the repo. |
| `no worktrees in <repo>` | The repo has no usable (non-bare) worktree. |
| `missing required argument: <key>` | A verb was called without a required arg (e.g. `send` with no text). |
| `not a navigable http(s) URL: <input>` | `browser navigate` got a non-web scheme. |
| `scripting blocked: non-local origin (<host>)` | `eval`/`click`/`fill` while the pane is on a remote site. Navigate to a local origin first. |
| `unknown command: <verb>` / usage printed, exit 2 | Typo in the verb, or a missing subcommand. |

---

## Raw socket API

The CLI is just a client over a documented wire protocol — you can talk to the
socket from any language.

- **Transport:** unix domain socket at `$TREELINE_SOCK` or
  `<userData>/cli.sock` (macOS: `~/Library/Application Support/treeline-app/cli.sock`),
  `chmod 0600`.
- **Framing:** newline-delimited JSON. Write one request line, read one response
  line, disconnect. The server processes every complete `\n`-terminated line on
  a connection.

**Request:**

```json
{ "verb": "open", "args": { "repo": "treeline-app", "branch": "feat-auth" } }
```

**Response (one of):**

```json
{ "ok": true, "data": { "opened": "/Users/me/code/treeline-app" } }
{ "ok": true }
{ "ok": false, "error": "unknown repo: nope" }
```

Verbs: `ping`, `repos`, `worktrees`, `notify`, `open`, `send`, `browser` (the
sub-action rides in `args.action`). Example with `socat`:

```bash
echo '{"verb":"ping"}' | socat - UNIX-CONNECT:"$HOME/Library/Application Support/treeline-app/cli.sock"
# {"ok":true,"data":{"ok":true,"app":"treeline","version":"0.25.0"}}
```
