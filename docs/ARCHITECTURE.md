# Architecture

This is the long version. For a quick orientation, see the README.

## Process model

Electron splits into two long-lived JavaScript processes that run
side-by-side:

- **Main** — Node.js with full filesystem and child-process access. Runs
  `node-pty`, the git CLI, the process scanners, and the JSON config
  store. Owns the application menu and the BrowserWindow.
- **Renderer** — Chromium with `contextIsolation: true`,
  `nodeIntegration: false`, `sandbox: true`. Has *no* direct file or
  process access; everything goes through the preload bridge.

A third process — **preload** — runs *once*, before the renderer's
JavaScript, and is the only place that has access to both Electron's
`ipcRenderer` and the renderer's `window`. Its sole job is to call
`contextBridge.exposeInMainWorld('treeline', api)` so the renderer can
say `window.treeline.repos.list()` instead of touching IPC directly.

```
┌──────────────────────────┐    ┌──────────────────────┐
│  Renderer (sandboxed)    │    │  Main (privileged)   │
│  React + Zustand         │    │  Node.js             │
│         │                │    │         │            │
│  window.treeline         │◄──►│  ipcMain.handle      │
│         │                │    │  webContents.send    │
│  ipc/client.ts ─► store  │    │         │            │
└──────────┬───────────────┘    │  PtyManager          │
           │ contextBridge      │  WorktreeWatcher     │
           ▼                    │  ProcessMonitor      │
┌──────────────────────────┐    │  TerminalStatusMon.  │
│  Preload                 │    │  ReposStore          │
│  src/preload/index.ts    │    └──────────────────────┘
└──────────────────────────┘
```

## Data flow

### Adding a repo or folder

1. User clicks `+ Add repo / folder` in the sidebar.
2. Renderer calls `window.treeline.repos.pickDirectory()`.
3. Preload forwards via `ipcRenderer.invoke('repos:pickDirectory')`.
4. Main shows a native `dialog.showOpenDialog` and returns the path.
5. Renderer calls `window.treeline.repos.addPath(path)`.
6. Main classifies the path with `resolveParentRepoPath` (`git rev-parse`):
   - **A git repo** (or any path inside one) → persisted as a repo via the
     `ReposStore`, the `WorktreeWatcher` starts watching it, and the handler
     returns `{ kind: 'repo', repo }`.
   - **Anything else** → pinned as a plain non-git **folder** (`ReposStore.addFolder`),
     returning `{ kind: 'folder', folder }`. A folder roots a bare file tree
     with no worktrees and no Changed/diff (see *Open folders* in the README).
7. The store persists to `~/Library/Application Support/treeline-app/config.json`.
   Renderer reads the updated config; for a repo it also calls
   `window.treeline.worktrees.list(path)` to populate the sidebar.

### Opening a terminal

1. User clicks a worktree row.
2. Renderer's `actions/tabs.ts:openTabAt(cwd)` checks `tabsByCwd[cwd]`
   in the Zustand store. If a tab exists, focus its MRU; otherwise:
3. Renderer calls `window.treeline.pty.spawn({ cwd, cols, rows })`.
4. Main's `PtyManager.spawn()` calls `node-pty.spawn(SHELL, ['-l'],
   { name: 'xterm-256color', cwd, env: sanitized })`. Returns a UUID.
5. Renderer adds a `Tab` to the store whose `root` is a single-leaf pane
   tree holding that UUID (a tab is a tree of panes —
   `root: PaneNode` + `focusedPaneId` — not one `ptyId`).
6. Main emits `'spawned'`, which routes to the
   `TerminalStatusMonitor.register(id, shellPid)` so the foreground-
   process detector starts watching this PTY's children.
7. The renderer renders the tab's pane tree (`<PaneTreeView>` → a
   `<PaneView>` per leaf); each `PaneView`'s `useXterm` hook calls
   `term.open(container)`, attaches `FitAddon`, runs `fit.fit()`, and
   subscribes via `window.treeline.pty.onData(id, chunk => term.write(chunk))`.
8. Keystrokes from xterm: `term.onData(d => window.treeline.pty.write(id, d))`.

### Viewing a file (code viewer)

1. User clicks the folder icon on a worktree row. Renderer's
   `actions/editor.ts:toggleDir(path)` flips `expandedDirs[path]` in the
   store and, on every expand, calls `window.treeline.files.readDir(path)`.
   The All tree has no fs watcher, so re-reading on each expand is what
   surfaces files added since the last listing — collapse + re-expand a
   folder to pick up new entries. Cached children stay rendered while the
   fresh read is in flight (no "loading…" flash); a failed refresh keeps
   the previous listing rather than blanking the folder.
2. Main's `files-io.ts:listDir()` reads one directory level (`.git`
   hidden, dirs-first sort) and returns `DirEntry[]`, cached in the editor
   slice's `dirChildren`. `<FileTree>` renders it; sub-dirs repeat step 1.
3. User clicks a file. `actions/editor.ts:openFileInPanel(path)` calls
   `window.treeline.files.read(path)`.
4. Main's `files-io.ts:readFileGuarded()` stats the file, reads up to
   1 MB (flagging `truncated`), sniffs the head for a NUL byte (flagging
   `binary`), and returns `FileContents`.
5. The editor slice stores the result (ignoring it if the user already
   switched files), `<MainArea>` splits in `<CodePanel>`, and
   `<CodeMirrorView>` renders it read-only with an extension-derived
   language and the Graphite theme. (Markdown files instead default to the
   rendered **Preview** — see below.)

The `All | Changed` toggle (`<WorktreeFiles>`) swaps the tree for
`<ChangedFilesList>`, fed by `window.treeline.files.changed(path)` →
`git.ts:changedFiles()` (parses `git status --porcelain`). The list
re-fetches whenever `worktrees:onChange` fires for that repo — i.e. on the
same `.git` watcher + ~5 s poll that drives the dirty dot, so commits and
git ops refresh promptly while a bare working-tree save isn't instant.

Clicking a changed file opens its **diff** instead of the full file:
`files.diff(path)` → `git.ts:fileDiff()` runs `git diff HEAD` (untracked
files become all-additions) and `parseUnifiedDiff()` turns the patch into
`{ lines, added, removed }`. `<DiffView>` renders it; the panel's
`Diff | File` toggle flips `panelMode`, lazily loading whichever
representation isn't cached yet.

**Markdown preview.** `panelMode` has a third value, `'preview'`. Markdown
files (`isMarkdownPath()` — `.md`/`.markdown`/`.mdx`) open on it by default;
`<CodePanel>` shows an extra `Preview` tab and renders `<MarkdownView>`
instead of `<CodeMirrorView>`. Preview reuses the same `openFileText` the
File view loads (no separate fetch), so toggling between them is free.
`<MarkdownView>` renders with `react-markdown` + `remark-gfm` (tables, task
lists, …) + `rehype-highlight` (fenced-code highlighting, themed via
`.hljs-*` rules in `globals.css`). It emits React elements only — no
`dangerouslySetInnerHTML` and no raw embedded HTML — so it stays within the
renderer's strict CSP; links use `target="_blank"`, which routes through the
main window's `setWindowOpenHandler` (safe schemes → `shell.openExternal`).

**Editing.** The File view flips editable via the panel's `Edit` button
(`editing` + a `draft` in the editor slice). `⌘S` / Save calls
`saveOpenFile()` → `files.write(path, draft)` → `files-io.ts:writeFileGuarded()`,
which writes a sibling temp file and `rename()`s it over the target
(atomic) and refuses anything but an existing regular file. On success the
saved text becomes the clean baseline and the diff + Changed list refresh.
Switching files / closing the panel with unsaved edits prompts first
(`confirmDiscard`); truncated and binary files stay read-only.

Both read handlers validate the renderer-supplied path with `safe-path.ts`.
This isn't a new trust boundary — PTYs already grant full shell access —
so the guards are about robustness (don't freeze on a huge file, don't
render garbage for a binary), not sandboxing.

### Embedded browser

`⌘⇧B` (menu **View → Toggle Browser**, channel `browser:toggle`) flips
`browserPanelOpen` in the **browser slice**. `<MainArea>` then mounts a third
region — `<BrowserPanelResizer>` + `<BrowserPane>` — to the right of the
optional code panel, reusing the code viewer's split idiom.

`<BrowserPane>` hosts an Electron **`<webview>`** (enabled via
`webPreferences.webviewTag`). Navigation is split in two: `browserSrc` is bound
to the element's `src` and only changes on an explicit address-bar submit, while
the live location (`browserAddress`, fed from the guest's `did-navigate` events)
drives the address bar — so an in-page link click is never clobbered by a
re-render. Back/forward/reload are imperative through the element ref; typed
input is normalised by `shared/browser-url.ts` (bare `host:port` → `http://`,
non-web schemes refused). The `<BrowserPanelResizer>` uses pointer *capture* (vs
the code panel's window listeners) so the drag survives the cursor crossing into
the webview's separate process.

Unlike the code viewer's `safe-path` guard (robustness, not a trust boundary),
this is a real network-capable browser, so it genuinely widens the trust
surface — and is hardened in `hardenWebviews()`: the guest gets its own
`persist:treeline-browser` session, attaches with no preload / no node
integration / isolation on (`will-attach-webview`), and its new-window attempts
route through the same safe-scheme `setWindowOpenHandler` as the main window.
The renderer CSP gains `frame-src http: https:` so the frame can load. The pane
is also **scriptable** so an agent can verify its own change — see the CLI's
`browser` verbs below; that surface is where the trust-widening actually bites,
so its acting verbs are gated to local origins.

### Scriptable CLI (socket → app)

The app is driveable from outside the GUI over a unix domain socket, so scripts
and agents can issue the same verbs a user would click.

1. In `app.whenReady` (alongside the monitors), `main/index.ts` starts a
   `CliServer` (`main/cli-server.ts`) listening on `cliSocketPath(userData)` —
   `…/Application Support/treeline-app/cli.sock`. The socket is `chmod 0600` and
   never network-bound: it grants control of the app (and thus its PTYs), so it's
   user-scoped by construction. A stale socket from an unclean exit is unlinked
   before `listen`; `before-quit` closes it.
2. The protocol is newline-delimited JSON (`shared/cli-protocol.ts`, kept free of
   node imports so the sandboxed preload can share its types). A client writes one
   `{verb,args}` line and reads one `{ok,…}` line.
3. `CliServer` dispatches against a handler map built by `buildCliHandlers(deps)`
   (`main/cli-handlers.ts`). The deps are the *same* services the IPC layer calls
   (`ReposStore`, `git.listWorktreesIn`, a notify fn, a renderer-command fn), so a
   socket verb and a GUI action can't diverge. `resolveWorktree` maps a
   `{repo, branch?}` selector to a concrete worktree path.
4. Verbs that need the UI are forwarded to the renderer over a `cli:command`
   channel: `open` focuses the window and calls the same `openTabAt(cwd)` a sidebar
   click takes; `send` writes its text to the *focused* tab's PTY (`pty.write`).
   `notify` feeds the **agent-attention notifications** below (target resolution
   lives in `main/notification-targets.ts`, unit-tested): with a `paneId` (the
   Claude Code hook reads it from the `TREELINE_PANE_ID` env var treeline exports
   into every shell) main lights *exactly* that pane; otherwise it matches by
   `cwd` but **only when that resolves to a single pane** — two tabs on the same
   directory are indistinguishable by cwd, so fanning out to both would flag the
   wrong agent (Claude also fires some notifications from a process that doesn't
   inherit `TREELINE_PANE_ID`, so a pane id can't be guaranteed). When neither
   pinpoints a unique pane it falls back to a plain Electron `Notification`
   (click-to-focus, no focus-steal — important since a Claude `Stop` hook fires it
   on every turn).
5. The `browser` verbs drive the embedded pane (the **agent act-then-verify loop**:
   `navigate` / `snapshot` / `query` / `eval` / `click` / `fill` / `screenshot`).
   They run mostly **main-direct**, not renderer-forwarded: `main/browser-guest.ts`
   holds the guest `<webview>`'s `WebContents` — captured the moment it attaches in
   `hardenWebviews()`'s `did-attach-webview`, the *only* place main gets that handle —
   and exposes the ops on it. `navigate` is the exception, forwarded to the renderer
   (opening the pane is React state). Structured input (`snapshot`/`query`/`click`/
   `fill`) drives a CDP session via `webContents.debugger` (lazy `attach('1.3')`,
   reset when the guest changes); `click`/`fill` resolve a CSS selector to viewport
   coordinates then dispatch **synthetic** `Input` events. Because this lets an agent
   *act* on a live page, the mutating verbs (`eval`/`click`/`fill`) call
   `assertScriptableOrigin` and run only on `localhost`/`127.0.0.1`/`[::1]`; the
   read-only verbs (`navigate`/`snapshot`/`query`/`screenshot`) work on any origin.
6. `bin/treeline.mjs` is the standalone client — dependency-free Node, symlinkable
   onto `PATH`. Beyond the socket verbs it carries the Claude Code glue:
   `hooks setup` atomically merges `Stop`/`Notification` hooks into
   `~/.claude/settings.json` (idempotent; honours `CLAUDE_CONFIG_DIR`) pointing at
   an internal `notify-hook`, which reads the hook's stdin JSON, derives a message
   **and the agent's cwd**, fires `notify` with that cwd, and **always exits 0** so
   it can never disrupt a Claude turn. (It reports the cwd over the socket rather
   than emitting an OSC escape because Claude Code runs hooks with no controlling
   terminal — `/dev/tty` is `ENXIO`.)

### Settings, theming & keybindings

Settings (`SettingsConfig`: `terminalTheme`, `fontFamily`, `fontSize`,
`keybindings`) live in `AppConfig` and persist through the same atomic
`ReposStore`. The store is at `schemaVersion: 4`; `migrate()` default-fills the
whole `settings` block for any pre-v3 config and the `folders` array for any
pre-v4 config (both default to empty/factory values), and sanitises
partial/corrupt entries (wrong-typed fields dropped), so an older install
upgrades silently. `migrate()` is the single owner of the schema — new
persisted fields are added here and the version bumped once.

**App-wide theming runs on CSS variables.** The nine `treeline-*` Tailwind tokens
(`tailwind.config.ts`) don't hold colors — each resolves to
`var(--treeline-<slot>)`. `globals.css` seeds those variables with the Graphite
palette so the very first paint is on-theme, and the `mono` font token resolves
to `var(--treeline-font-mono)` (the whole app inherits `font-mono` from
`<body>`). At runtime `useAppTheme` (mounted once in `App.tsx`) reads
`settings.terminalTheme` / `fontFamily` and writes the selected preset's `app`
palette + font onto `document.documentElement`, so a theme switch repaints the
entire chrome **and** reflows the font instantly, no reload. The same preset's
xterm `ITheme` is applied per-pane by `useXterm`, and `main` seeds the
`BrowserWindow.backgroundColor` from the persisted theme so cold start doesn't
flash the default. Presets are pure data in `shared/terminal-theme.ts` (one
home for the id → xterm-theme + app-palette mapping, importable by both main and
renderer).

**Keybindings are one resolved map, two consumers.** `shared/keybindings.ts`
holds the command table (`KEYBINDING_DEFS`) and `resolveKeybindings(overrides)`
(user overrides merged over defaults). `main/menu.ts` builds its accelerators
from that map, and the renderer reads the same map for non-menu handlers — a
binding lives in exactly one place. The Settings modal validates as you type:
`findKeybindingConflicts` catches two commands sharing a chord and
`findReservedConflicts` catches a chord owned by a built-in menu role (Paste,
Copy, Quit, …) — both normalise modifier order/aliases (`Cmd+V` ≡ `CmdOrCtrl+V`),
flag the offending field, and block Save. On save, `config.setSettings` persists
and fires `onSettingsChanged`, which rebuilds the menu (`buildAppMenu`) so a
rebind takes effect without a restart.

### Live worktree updates

1. `WorktreeWatcher` registers an `fs.watch` on each `<repo>/.git`
   directory (non-recursive — that's where the `worktrees/` subdir
   appears or disappears) plus a 5 s polling fallback.
2. When `git worktree add ...` runs *inside one of the open terminals*,
   git creates `<repo>/.git/worktrees/<name>/`, which fires the watcher.
3. Watcher debounces 200 ms, runs `listWorktreesIn(repoPath)`, JSON-
   stringifies it, compares against the cached snapshot, and emits
   `change` only if the snapshot differs.
4. `main/index.ts` translates the event into a
   `webContents.send('worktrees:onChange', repoPath)` to every renderer.
5. Renderer's `ipc/client.ts` re-fetches and updates the store, the
   sidebar re-renders.
6. The `ProcessMonitor` is also notified so its longest-prefix index
   can include the new path.

### AI CLI detection

The `ProcessMonitor` ports `dashboard.rs:103-148` exactly:

1. Every 2 s, run `ps -axo pid=,time=,command=`.
2. For each row, basename the first whitespace token of `command`. Keep
   only `claude` / `opencode` / `aider`.
3. For each surviving PID, run `lsof -a -d cwd -p <pid> -Fn` (in
   parallel via `Promise.all` — the Rust version was serial).
4. Maintain a `Map<pid, {cputime, lastChange}>`. If cputime moved >
   0.01 since the previous tick, mark non-idle and update lastChange.
   Else mark idle if `now - lastChange ≥ 10000 ms`.
5. Build the snapshot, compute `byWorktreePath` via longest-prefix
   match against the WorktreeWatcher's known paths, broadcast.

The renderer's sidebar reads `processesByWorktreePath[wt.path]`
directly; no per-render computation.

### Listening ports

The same `ProcessMonitor` tick runs a second, independent pass that
attributes listening TCP ports to worktrees:

1. The process scan and the port scan run concurrently via
   `Promise.allSettled`, so a slow or failing `lsof` in either can't take
   down the other — a rejected port scan just yields no chips that tick.
2. The port scan runs `lsof -iTCP -sTCP:LISTEN -nP` and parses
   `{pid, port}` from each row's trailing `:PORT` (handles `*:3000` and
   `[::1]:5173`).
3. Each listening PID's cwd is resolved with `lsof -a -d cwd -p <pid> -Fn`.
   Because that probe is expensive, results go through a cross-tick
   `Map<pid, cwd>` cache (probed at most once per PID, pruned to the PIDs
   still listening each scan).
4. `indexPortsByWorktreePath` attributes each listener to a worktree by
   the same longest-prefix match used for processes; ports are deduped
   and sorted, and listeners with no resolvable/matching cwd are dropped.

The snapshot carries `portsByWorktreePath` alongside `byWorktreePath`;
the sidebar reads `portsByWorktreePath[wt.path]` to render the `:PORT`
chips. Attribution is by the listener's cwd, so a server started outside
treeline still shows up as long as it's rooted in the worktree.

### Linked PR status (gh)

The `PrMonitor` (`main/pr-monitor.ts`) is a separate monitor from the
`ProcessMonitor` — PR status is a per-repo network call, not a per-process
local probe — but it follows the same EventEmitter + broadcast-on-change
shape:

1. `start()` probes `ghAvailable()` once (`gh --version`, memoized). No
   `gh` on PATH → the monitor stays dormant and the feature is a no-op.
2. A 60 s timer polls every tracked repo; `setRepoPaths()` (seeded from
   the repo list, kept in sync by the repo add/remove hooks) refreshes
   newly-added repos immediately, and the `WorktreeWatcher`'s `change`
   broadcast triggers a targeted `refreshRepo()` so a new branch's PR
   surfaces without waiting for the next tick.
3. `main/gh.ts` runs `gh pr list --state all --json
   number,state,isDraft,headRefName,url,statusCheckRollup` (`cwd` = repo),
   indexes by `headRefName`, maps `state`+`isDraft` → `PrState`, and
   reduces `statusCheckRollup` → one `PrChecks` (any failure → failing;
   else any in-flight → pending; else passing). Any non-zero exit — no
   GitHub remote, unauthenticated, offline, timeout — degrades to `{}`.
4. A per-repo `refreshing` guard coalesces overlapping fetches; the
   monitor emits `update { repoPath, prByBranch }` only when a repo's map
   actually changes (JSON-diffed against the last broadcast).

Unlike the process/port indexes (keyed by worktree path), PR data is keyed
by **repo + branch** and lives in its own side map — `git-porcelain.ts`
and the `Worktree` type stay pure and network-free. `ipc/pr.ts` holds the
latest-per-repo snapshot (served on `pr:snapshot` for first paint) and
broadcasts deltas on `pr:update`; the renderer stores them in
`prByRepoBranch[repoPath][branch]`, and `WorktreeRow` renders `<PrBadge>`
from `prByRepoBranch[repoPath]?.[worktree.branch]`. Clicking the badge
calls `system.openExternal`, which validates the URL against the same
`isSafeExternalUrl` web/mail allowlist used for terminal links before
handing it to `shell.openExternal`.

### Per-tab status (running / idle / exited)

Independent from AI CLI detection — answers the simpler question "does
this tab's shell have a foreground process running right now?"

1. Every 1 s, run `ps -A -o pid=,ppid=,comm=`.
2. Bucket children by `ppid`. For each registered PTY's `shellPid`:
   - No row anywhere with that pid → `exited`.
   - No children → `idle`, `foregroundCmd: null`.
   - Children present → `running`, `foregroundCmd` = basename of the
     highest-PID child (the most-recent fork).
3. Maintain per-PTY last-emitted state; only emit deltas.
4. Renderer detects the `running → idle` transition itself and pulses
   the row green for 800 ms ("just finished" feedback).

### Agent attention notifications (rings, badges, jump-to-unread)

A *deliberate* "needs you" signal, distinct from the inferred running/idle state
above (a blocked agent and a finished one look identical to `ps`). Two ingest
paths converge on a single `PtyManager` `notification` event `{ id, text }`:

1. **OSC scan.** `PtyManager`'s existing per-PTY output scanner (the one that
   parses OSC 7 cwd) also matches **OSC 9 / 99 / 777** desktop-notification
   sequences and emits `notification`. Any terminal program can trigger it.
2. **Claude Code hook → pane id.** Claude Code hooks have no controlling terminal,
   so the `notify-hook` reports over the socket. treeline exports a
   `TREELINE_PANE_ID` env var into every shell it spawns; the hook inherits it (via
   the agent process tree) and sends it back, so the `notify` dep lights *exactly*
   that pane (`PtyManager.has`). It also sends its cwd, used only as a *unique*-pane
   fallback for shells treeline didn't spawn (or hook firings that lost the env
   var — Claude raises some notifications from a process that doesn't inherit it).
   Because cwd can't tell two tabs in the same directory apart, a cwd that matches
   more than one pane lights *none* of them (a window-level toast fires instead);
   see `notification-targets.ts`. Either way it re-emits the *same* `notification`
   event, reusing everything downstream.

`registerPtyIpc` broadcasts `notification` to the renderer over `pty:notification`;
`markNotification(ptyId, text)` records it in a **transient, never-persisted**
`unreadByPtyId` map in the tabs slice. From there: the pane gets a magenta ring
(`PaneView`), the tab a pulsing magenta "waiting" style (`TabItem`), and the
worktree row an unread dot (`WorktreeRow`, cwd-keyed). The same event also raises
a native `Notification` when the window is unfocused. Focusing a pane/tab clears
its entry; **⌘⇧U** (`jumpToUnread` keybinding → menu → renderer) focuses the
most-recently-unread pane.

### Quit

1. `before-quit` fires.
2. WorktreeWatcher, TerminalStatusMonitor, ProcessMonitor, PrMonitor stop.
3. PtyManager calls `proc.kill('SIGHUP')` on every PTY.
4. Each PTY gets 200 ms to exit gracefully.
5. Holdouts get `SIGKILL`.
6. `app.quit()` proceeds.

## Why these choices

### Tailwind, not CSS Modules

The UI is small and styling is mostly utility classes. The Treeline
palette is finite, so it lives once in `tailwind.config.ts` as theme
tokens (`treeline-green`, `treeline-magenta`, etc.) and gets reused
everywhere. CSS Modules would mean writing hand-named classes for every
component to express "magenta foreground when claude" — pure overhead
on a UI surface this size.

### Zustand sliced by domain, not one big Context

State is split into orthogonal slices (currently **11**: `repos`, `tabs`,
`processes`, `editor`, `browser`, `settings`, `modal`, `scratch`,
`discoveries`, `drift`, `screenshot`), each updated from a different source:

- Repos / worktrees, updated from IPC events (`worktrees:onChange`) and
  user clicks.
- Tabs, updated from user clicks and PTY spawn/exit.
- Processes (+ ports), updated from a 2 s tick.
- …and the rest (code viewer, browser pane, settings, modals, scratch
  terminals, discovered-repo / worktree-drift toasts).

A single `useContext` provider would re-render every consumer on every
PTY tick. Zustand selectors with shallow equality
(`useStore(useShallow(s => …))`) sidestep that with no provider
boilerplate, and IPC subscribers can call `useStore.setState` from
outside React.

### node-pty native rebuild

`node-pty` ships prebuilt binaries for Node, not Electron. Electron has
its own (different) ABI. Without a rebuild, the renderer process tries
to load `pty.node` and crashes with `Module did not self-register`.

The fix is `electron-builder install-app-deps`, wired as a
`postinstall` script. It:

- Detects the active Electron version from `node_modules/electron/`.
- Spawns `@electron/rebuild` with the appropriate target, which
  recompiles `node-pty` against Electron's headers and copies the new
  `pty.node` into `node_modules/node-pty/build/Release/`.
- For packaging, it does this once per target architecture (`arm64` and
  `x64`) and ships both binaries inside `app.asar.unpacked/` (asar can't
  load native modules).

### Coalesced PTY data

`node-pty.onData` fires per chunk — sometimes every 64 bytes during
heavy output. With one `webContents.send` per chunk, IPC overhead
dominates the renderer.

`PtyManager` batches: each PTY has a `pendingChunks: string[]` and a
`flushScheduled: boolean`. On `onData`, push the chunk and schedule a
`setImmediate(flush)` if not already scheduled. `flush` joins the
chunks and sends one IPC event. This collapses ~50× during `npm install`
output bursts at no perceptible latency cost.

### Hidden tabs stay mounted

Inactive `<PaneView>` components don't unmount — they get
`visibility: hidden; pointer-events: none; position: absolute`. Each
xterm instance keeps consuming `term.write(chunk)` while hidden, so
switching back is instant. The alternative — buffering data in main
and replaying on show — is strictly more code and produces visible
catch-up flicker.

### Unified TitleBar

`titleBarStyle: 'hiddenInset'` removes the OS titlebar but keeps the
traffic-light buttons floating at the top-left. Without a custom
draggable region, the window can't be moved, and any UI in the top
~40 px clashes with the lights.

`<TitleBar>` is a single 36 px-tall flex row with
`-webkit-app-region: drag` on the strip and `-webkit-app-region: no-drag`
on its child button. The 78 px left gutter clears the lights with
margin to spare. The "treeline" wordmark and the sidebar collapse
toggle live inside it.

## File layout (annotated)

```
bin/treeline.mjs                  # Standalone CLI client (socket verbs + Claude Code hooks).
src/
├── shared/                       # Pure code; imported by main AND renderer.
│   ├── types.ts                  # Repo, Worktree, Tab, ProcessSnapshot…
│   ├── ipc-channels.ts           # `repos:list` etc. — string constants.
│   ├── ipc-contract.ts           # The TreelineApi interface (one source of truth).
│   ├── cli-protocol.ts           # CLI socket protocol: verbs + NDJSON frames (no node imports).
│   ├── pane-tree.ts              # PURE split-pane model: split/remove/focus-neighbour ops.
│   ├── browser-url.ts            # normalizeBrowserUrl() + isLocalDevUrl() for the browser pane.
│   ├── changed-poll.ts           # Changed-files poll interval helper.
│   ├── keybindings.ts            # Command table + resolve/conflict/reserved (pure).
│   ├── terminal-theme.ts         # Theme presets: xterm ITheme + app palette + font.
│   └── claude-detect.ts          # detectClaudeWorktree(path, branch).
│
├── main/
│   ├── index.ts                  # app.whenReady wiring.
│   ├── cli-server.ts             # CliServer: unix-socket NDJSON server (0600).
│   ├── cli-handlers.ts           # CLI verb handlers + resolveWorktree.
│   ├── cli-socket-path.ts        # cli.sock path under userData.
│   ├── cli-install.ts            # Writes the `treeline` shim + global-install symlink.
│   ├── browser-guest.ts          # Guest <webview> WebContents + scriptable ops (CDP snapshot/click/fill; localhost guard).
│   ├── menu.ts                   # macOS menu template; accelerators from the keybinding map.
│   ├── git.ts                    # execFile wrappers around the git CLI.
│   ├── git-porcelain.ts          # PURE parser. No IO. 100 % unit-tested.
│   ├── gh.ts                     # gh CLI: list PRs per repo; PURE parse/rollup helpers.
│   ├── pty-manager.ts            # Owns the node-pty Map; chunk coalescing; PATH-injects the CLI shim; pause/resume (subtree SIGSTOP/SIGCONT).
│   ├── process-monitor.ts        # 2 s ps + lsof; idle CPU tracking; listening-port scan.
│   ├── pr-monitor.ts             # 60 s gh PR poll per repo; emit-on-change broadcast.
│   ├── terminal-status.ts        # 1 s pgrep-style foreground detection.
│   ├── worktree-watcher.ts       # fs.watch on .git/worktrees + 5 s poll.
│   ├── worktree-drift-monitor.ts # Flags a PTY whose cwd drifts into another tracked worktree.
│   ├── claude-session.ts         # Find/copy a Claude transcript across project folders (resume-in-worktree handoff). PURE fs.
│   ├── repo-discovery.ts         # PTY cwd → untracked-repo detection (discovered-repo toasts).
│   ├── repos-store.ts            # Atomic JSON config; schema-versioned.
│   ├── repos-create.ts           # `git init` flow with new/existing-folder validation.
│   ├── files-io.ts              # Code-viewer fs: listDir + read + atomic write.
│   ├── screenshot.ts             # Dev-only headless capture harness (TREELINE_SCREENSHOT_ID).
│   ├── updater.ts                # electron-updater: launch + 4 h checks; manual menu check.
│   ├── ipc/                      # One handler module per domain.
│   │   ├── repos.ts              # repos:list/add/remove/pickDirectory.
│   │   ├── worktrees.ts          # list/create/remove + onChange events.
│   │   ├── pty.ts                # spawn/write/resize/kill/pause/resume + data/exit.
│   │   ├── claude-session.ts     # claudeSession:prepareResume — copy parent-repo session into a worktree.
│   │   ├── processes.ts          # snapshot + update events.
│   │   ├── pr.ts                 # pr:snapshot + pr:update events (latest-per-repo).
│   │   ├── system.ts             # system:openExternal (safe-url allowlist).
│   │   ├── terminal-status.ts    # update events (broadcast helper).
│   │   ├── files.ts             # files:readDir/read/changed/diff/write (validate → files-io/git).
│   │   └── config.ts             # config:get/setSidebarCollapsed/setCodeRoot/setSettings.
│   └── util/
│       ├── exec.ts               # execFile with timeout + ProcessError.
│       ├── safe-path.ts          # Validate paths/branches from the renderer.
│       └── safe-url.ts           # isSafeExternalUrl — web/mail-only allowlist for openExternal.
│
├── preload/index.ts              # contextBridge.exposeInMainWorld('treeline', api).
│
└── renderer/
    ├── main.tsx                  # Renderer entry: mounts <App> into index.html.
    ├── App.tsx                   # <TitleBar> + <Sidebar> + <MainArea> + <Modals>.
    ├── styles/globals.css        # Tailwind + .drag/.no-drag utilities.
    ├── components/
    │   ├── TitleBar.tsx
    │   ├── Sidebar.tsx
    │   ├── SidebarResizer.tsx
    │   ├── SidebarToggle.tsx
    │   ├── FilterInput.tsx
    │   ├── AddRepoButton.tsx
    │   ├── NewRepoButton.tsx     # `git init` a brand-new repo.
    │   ├── RepoNode.tsx          # Per-repo collapsible group.
    │   ├── FolderNode.tsx        # Pinned non-git folder: bare file tree, no worktrees.
    │   ├── WorktreeRow.tsx       # branch · sha · dirty · status · processes · ports · PR.
    │   ├── TabStatusDot.tsx
    │   ├── ProcessBadge.tsx
    │   ├── PrBadge.tsx           # #NNN colored by PR state + CI glyph; opens PR on click.
    │   ├── MainArea.tsx          # Splits terminal + optional code panel.
    │   ├── TabBar.tsx
    │   ├── TabItem.tsx
    │   ├── TerminalHost.tsx      # Renders all tabs; only active is visible.
    │   ├── PaneTreeView.tsx      # Recursive split tree → flex rows/cols + dividers.
    │   ├── PaneView.tsx          # One xterm instance per pane leaf (focus ring/badge).
    │   ├── WorktreeFiles.tsx     # All|Changed toggle under an expanded worktree.
    │   ├── FileTree.tsx          # Lazy per-worktree file tree (+ FileTreeNode).
    │   ├── ChangedFilesList.tsx  # Flat git-status list (M/A/?/D/R letters).
    │   ├── CodePanel.tsx         # Viewer panel; Preview|Diff|File toggle + states.
    │   ├── CodeMirrorView.tsx    # CodeMirror 6, language by extension.
    │   ├── MarkdownView.tsx      # Rendered markdown Preview (react-markdown + GFM).
    │   ├── DiffView.tsx          # Unified diff rows (line nums, +/- colors).
    │   ├── codemirror-theme.ts   # Graphite theme (chrome + syntax tokens).
    │   ├── CodePanelResizer.tsx  # Draggable terminal/panel divider.
    │   ├── BrowserPane.tsx       # Embedded <webview>; address bar + nav + states.
    │   ├── BrowserPanelResizer.tsx # Terminal/browser divider (pointer capture).
    │   ├── ScratchList.tsx       # Scratch (repo-less) terminals group.
    │   ├── ScratchRow.tsx
    │   ├── ScratchTerminalButton.tsx
    │   ├── DiscoveredRepoToast.tsx # "Add this untracked repo?" toast.
    │   ├── WorktreeDriftToast.tsx  # "Open a terminal in this worktree?" toast; + "Resume Claude here" handoff.
    │   ├── ScreenshotForceTooltip.tsx # Dev-only screenshot-harness helper.
    │   └── modals/
    │       ├── ModalShell.tsx
    │       ├── CreateRepoModal.tsx
    │       ├── CreateWorktreeModal.tsx
    │       ├── DeleteWorktreeModal.tsx
    │       ├── ConfirmDiscardModal.tsx
    │       ├── SettingsModal.tsx # Appearance (theme/font) + keybindings editor.
    │       └── Modals.tsx        # Renders whichever modal is open.
    ├── hooks/useXterm.ts         # Owns the Terminal lifecycle for one pane.
    ├── hooks/useAppTheme.ts      # Writes the theme palette + font onto :root.
    ├── hooks/useGlobalShortcuts.ts # Window-level split-pane chords (⌘D / ⌘⌥-arrows / ⌘⇧W).
    ├── store/
    │   ├── index.ts              # Composes the slices.
    │   ├── repos-slice.ts        # repos, folders, worktreesByRepo, prByRepoBranch, filter, collapsed.
    │   ├── tabs-slice.ts         # tabs (pane trees), activeTabId, tabsByCwd (MRU) + pane reducers.
    │   ├── processes-slice.ts    # processes, processesByWorktreePath, portsByWorktreePath.
    │   ├── editor-slice.ts       # code panel: open file, tree expand/cache.
    │   ├── browser-slice.ts      # browser pane: open/width, src/address, nav state.
    │   ├── settings-slice.ts     # settings + derived resolved keybinding map.
    │   ├── modal-slice.ts        # which modal (if any) is open.
    │   ├── scratch-slice.ts      # repo-less scratch terminals.
    │   ├── discoveries-slice.ts  # untracked-repo discovery suggestions.
    │   ├── drift-slice.ts        # worktree-drift / -created open suggestions.
    │   ├── handoff-slice.ts      # parked origin ↔ worktree-fork links for the resume-Claude handoff.
    │   └── screenshot-slice.ts   # dev-only screenshot-mode flags.
    ├── actions/tabs.ts           # openTabAt(cwd, {forceNew}), closeTab(id), split/close pane; resumeSessionInWorktree / returnToOriginal (park handoff).
    ├── actions/editor.ts         # openFileInPanel(path), toggleDir(path).
    ├── actions/scratch.ts        # open/close scratch terminals.
    ├── ipc/client.ts             # Subscribes IPC events into the store.
    ├── types/webview.d.ts        # JSX typing for the Electron <webview> tag.
    └── util/path.ts              # Tiny basename() (no Node access here).

scripts/
├── setup-test-scenarios.sh       # Creates fixture repos under .test-code-root/.
├── launch-with-test-scenario.sh  # Setup + pre-loaded config + npm run dev.
├── take-screenshots.sh           # Walks you through capturing README images.
└── README.md

tests/                            # 26 Vitest suites (main-process logic; renderer verified manually).
├── claude-detect.test.ts
├── git-porcelain.test.ts
├── git.test.ts
├── repos-store.test.ts
├── repos-create.test.ts
├── files-io.test.ts
├── repo-discovery.test.ts
├── repo-discovery.integration.test.ts
├── pty-manager.test.ts
├── terminal-status.test.ts
├── process-monitor.test.ts
├── changed-poll.test.ts
├── safe-url.test.ts
├── exec.test.ts
├── browser-url.test.ts
├── browser-guest.test.ts
├── pane-tree.test.ts
├── keybindings.test.ts
├── settings-migration.test.ts
├── gh.test.ts
├── pr-monitor.test.ts
├── worktree-drift-monitor.test.ts
├── cli-server.test.ts
├── cli-handlers.test.ts
├── cli-bin.test.ts
└── cli-install.test.ts
```
