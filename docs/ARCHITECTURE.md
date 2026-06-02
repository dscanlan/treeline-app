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

### Adding a repo

1. User clicks `+ Add repo` in the sidebar.
2. Renderer calls `window.treeline.repos.pickDirectory()`.
3. Preload forwards via `ipcRenderer.invoke('repos:pickDirectory')`.
4. Main shows a native `dialog.showOpenDialog` and returns the path.
5. Renderer calls `window.treeline.repos.add(path)`.
6. Main validates that the path is a git repo (`git rev-parse
   --show-toplevel`), persists it to `~/Library/Application
   Support/treeline-app/config.json` via the `ReposStore`, and tells the
   `WorktreeWatcher` to start watching the new repo.
7. Renderer reads the updated config and calls
   `window.treeline.worktrees.list(path)` to populate the sidebar.

### Opening a terminal

1. User clicks a worktree row.
2. Renderer's `actions/tabs.ts:openTabAt(cwd)` checks `tabsByCwd[cwd]`
   in the Zustand store. If a tab exists, focus its MRU; otherwise:
3. Renderer calls `window.treeline.pty.spawn({ cwd, cols, rows })`.
4. Main's `PtyManager.spawn()` calls `node-pty.spawn(SHELL, ['-l'],
   { name: 'xterm-256color', cwd, env: sanitized })`. Returns a UUID.
5. Renderer adds a `Tab` to the store with that UUID as `ptyId`.
6. Main emits `'spawned'`, which routes to the
   `TerminalStatusMonitor.register(id, shellPid)` so the foreground-
   process detector starts watching this PTY's children.
7. The renderer mounts a `<TerminalView>`, whose `useXterm` hook calls
   `term.open(container)`, attaches `FitAddon`, runs `fit.fit()`, and
   subscribes via `window.treeline.pty.onData(id, chunk => term.write(chunk))`.
8. Keystrokes from xterm: `term.onData(d => window.treeline.pty.write(id, d))`.

### Viewing a file (code viewer)

1. User clicks the folder icon on a worktree row. Renderer's
   `actions/editor.ts:toggleDir(path)` flips `expandedDirs[path]` in the
   store and, on first expand, calls `window.treeline.files.readDir(path)`.
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
   language and the Graphite theme.

Both handlers validate the renderer-supplied path with `safe-path.ts`.
This isn't a new trust boundary — PTYs already grant full shell access —
so the guards are about robustness (don't freeze on a huge file, don't
render garbage for a binary), not sandboxing.

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

### Quit

1. `before-quit` fires.
2. WorktreeWatcher, TerminalStatusMonitor, ProcessMonitor stop.
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

### Zustand with three slices, not one big Context

You have three orthogonal state domains updated from different sources:

- Repos / worktrees, updated from IPC events (`worktrees:onChange`) and
  user clicks.
- Tabs, updated from user clicks and PTY spawn/exit.
- Processes, updated from a 2 s tick.

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

Inactive `<TerminalView>` components don't unmount — they get
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
src/
├── shared/                       # Pure code; imported by main AND renderer.
│   ├── types.ts                  # Repo, Worktree, Tab, ProcessSnapshot…
│   ├── ipc-channels.ts           # `repos:list` etc. — string constants.
│   ├── ipc-contract.ts           # The TreelineApi interface (one source of truth).
│   └── claude-detect.ts          # detectClaudeWorktree(path, branch).
│
├── main/
│   ├── index.ts                  # app.whenReady wiring.
│   ├── menu.ts                   # macOS menu template; ⌘B accelerator.
│   ├── git.ts                    # execFile wrappers around the git CLI.
│   ├── git-porcelain.ts          # PURE parser. No IO. 100 % unit-tested.
│   ├── pty-manager.ts            # Owns the node-pty Map; chunk coalescing.
│   ├── process-monitor.ts        # 2 s ps + lsof; idle CPU tracking.
│   ├── terminal-status.ts        # 1 s pgrep-style foreground detection.
│   ├── worktree-watcher.ts       # fs.watch on .git/worktrees + 5 s poll.
│   ├── repos-store.ts            # Atomic JSON config; schema-versioned.
│   ├── files-io.ts              # Code-viewer reads: listDir + readFileGuarded.
│   ├── ipc/                      # One handler module per domain.
│   │   ├── repos.ts              # repos:list/add/remove/pickDirectory.
│   │   ├── worktrees.ts          # list/create/remove + onChange events.
│   │   ├── pty.ts                # spawn/write/resize/kill + data/exit.
│   │   ├── processes.ts          # snapshot + update events.
│   │   ├── terminal-status.ts    # update events (broadcast helper).
│   │   ├── files.ts             # files:readDir/read (validate → files-io).
│   │   └── config.ts             # config:get/setSidebarCollapsed/setCodeRoot.
│   └── util/
│       ├── exec.ts               # execFile with timeout + ProcessError.
│       └── safe-path.ts          # Validate paths/branches from the renderer.
│
├── preload/index.ts              # contextBridge.exposeInMainWorld('treeline', api).
│
└── renderer/
    ├── App.tsx                   # <TitleBar> + <Sidebar> + <MainArea> + <Modals>.
    ├── styles/globals.css        # Tailwind + .drag/.no-drag utilities.
    ├── components/
    │   ├── TitleBar.tsx
    │   ├── Sidebar.tsx
    │   ├── FilterInput.tsx
    │   ├── AddRepoButton.tsx
    │   ├── RepoNode.tsx          # Per-repo collapsible group.
    │   ├── WorktreeRow.tsx       # branch · sha · dirty · status · processes.
    │   ├── TabStatusDot.tsx
    │   ├── ProcessBadge.tsx
    │   ├── MainArea.tsx          # Splits terminal + optional code panel.
    │   ├── TabBar.tsx
    │   ├── TabItem.tsx
    │   ├── TerminalHost.tsx      # Renders all tabs; only active is visible.
    │   ├── TerminalView.tsx      # One xterm instance.
    │   ├── FileTree.tsx          # Lazy per-worktree file tree (+ FileTreeNode).
    │   ├── CodePanel.tsx         # Read-only viewer panel (header + states).
    │   ├── CodeMirrorView.tsx    # CodeMirror 6, language by extension.
    │   ├── codemirror-theme.ts   # Graphite theme (chrome + syntax tokens).
    │   ├── CodePanelResizer.tsx  # Draggable terminal/panel divider.
    │   ├── SidebarToggle.tsx
    │   └── modals/
    │       ├── ModalShell.tsx
    │       ├── CreateWorktreeModal.tsx
    │       ├── DeleteWorktreeModal.tsx
    │       └── Modals.tsx        # Renders whichever modal is open.
    ├── hooks/useXterm.ts         # Owns the Terminal lifecycle for one tab.
    ├── store/
    │   ├── index.ts              # Composes the slices.
    │   ├── repos-slice.ts        # repos, worktreesByRepo, filter, collapsed.
    │   ├── tabs-slice.ts         # tabs, activeTabId, tabsByCwd (MRU).
    │   ├── processes-slice.ts    # processes, processesByWorktreePath.
    │   ├── editor-slice.ts       # code panel: open file, tree expand/cache.
    │   └── modal-slice.ts        # which modal (if any) is open.
    ├── actions/tabs.ts           # openTabAt(cwd, {forceNew}), closeTab(id).
    ├── actions/editor.ts         # openFileInPanel(path), toggleDir(path).
    ├── ipc/client.ts             # Subscribes IPC events into the store.
    └── util/path.ts              # Tiny basename() (no Node access here).

scripts/
├── setup-test-scenarios.sh       # Creates fixture repos under .test-code-root/.
├── launch-with-test-scenario.sh  # Setup + pre-loaded config + npm run dev.
├── take-screenshots.sh           # Walks you through capturing README images.
└── README.md

tests/
├── claude-detect.test.ts
├── git-porcelain.test.ts
├── git.test.ts
├── repos-store.test.ts
├── pty-manager.test.ts
├── terminal-status.test.ts
└── process-monitor.test.ts
```
