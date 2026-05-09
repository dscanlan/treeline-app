# Developing

## Prerequisites

- macOS (only platform supported in v1).
- Node 20+. The repo is tested on 20.x and 23.x.
- Xcode Command Line Tools (`xcode-select --install`) — needed for the
  `node-pty` native build.

## First run

```bash
npm install
```

This also runs `electron-builder install-app-deps` via `postinstall`,
which rebuilds `node-pty` against Electron's ABI. If that fails (e.g.
because Xcode tools aren't installed), running it manually:

```bash
npx electron-rebuild -f -w node-pty
```

If you ever see `Module did not self-register` on app launch, the
rebuild step was skipped or didn't complete — re-run the command above.

## Loop

```bash
npm run dev
```

`electron-vite` runs main + preload + renderer with hot-reload. Edits
to renderer code (`src/renderer/**`) are HMR-applied without a restart;
edits to main or preload trigger a process relaunch.

For a richer demo dataset:

```bash
./scripts/launch-with-test-scenario.sh
```

This creates three fixture projects, pre-loads them into the app's
config, runs `npm run dev`, and cleans up everything when you quit.

## Tests

```bash
npm test                  # all suites, ~1.5 s
npm test -- --reporter=verbose
npx vitest                # watch mode
```

The git module's tests spin up real temp repos with `git init` and
`git worktree add`. They run with `GIT_CONFIG_GLOBAL=/dev/null` so they
don't pick up the developer's commit-signing config.

```bash
npm run typecheck         # tsc --noEmit on main + renderer
npm run lint
npm run format            # prettier --write
```

## Packaging

```bash
npm run package:mac
```

This:

1. Runs `electron-vite build` (produces `out/{main,preload,renderer}/`).
2. Runs `electron-builder --mac --arm64 --x64`. For each arch:
   - Re-runs `electron-rebuild` to get the right `pty.node`.
   - Bundles the app into `app.asar` plus an `app.asar.unpacked/`
     escape hatch for native modules.
   - Builds a `.dmg` and a `.zip`.

Output lands in `release/`:

```
release/
├── treeline-app-0.1.0.dmg              (x64)
├── treeline-app-0.1.0.dmg.blockmap
├── treeline-app-0.1.0-mac.zip          (x64)
├── treeline-app-0.1.0-mac.zip.blockmap
├── treeline-app-0.1.0-arm64.dmg
├── treeline-app-0.1.0-arm64.dmg.blockmap
├── treeline-app-0.1.0-arm64-mac.zip
├── treeline-app-0.1.0-arm64-mac.zip.blockmap
├── mac/                                # x64 unpacked .app
└── mac-arm64/                          # arm64 unpacked .app
```

The build is unsigned because the developer cert in this checkout is
expired. To produce a signed build, set `CSC_LINK` and `CSC_KEY_PASSWORD`
in the environment (or update `electron-builder.yml`) and re-run.

## Releasing

Two ways to publish a downloadable build:

**Tag a version.** Push a `v*` tag and the
[Release workflow](../.github/workflows/release.yml) builds the `.dmg`
+ `.zip` for arm64 and x64, then creates a GitHub Release with them
attached and auto-generated release notes.

```bash
git tag v0.2.0
git push origin v0.2.0
```

**Manual dispatch.** Open the workflow on GitHub Actions and click
"Run workflow". You'll be asked for a tag/version label and whether to
publish as a draft (default: yes). The artifacts are also uploaded to
the workflow run itself, so even without a Release you can download
them from the workflow's "Artifacts" panel.

The build is currently unsigned. To enable signing + notarization:

1. Renew your Apple Developer cert.
2. Add these secrets to the repo (Settings → Secrets → Actions):
   `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`,
   `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`.
3. Replace the `CSC_IDENTITY_AUTO_DISCOVERY: 'false'` line in
   `release.yml` with the env block commented above it.

`hardenedRuntime` and the entitlements file are already wired in
`electron-builder.yml` — once the secrets are present, electron-builder
will sign and notarize automatically.

## Updating screenshots

```bash
./scripts/launch-with-test-scenario.sh   # in one terminal
./scripts/take-screenshots.sh            # in another
```

The screenshot helper walks you through each shot interactively,
prompting you to set the app to the right state before clicking the
window. PNGs land in `docs/img/` with stable filenames the README
references.

## Common gotchas

### "Module did not self-register"

`node-pty` was built for the wrong runtime. Re-run `npm install` or
`npx electron-rebuild -f -w node-pty`.

### Tests hang on `git commit`

Your git config has `commit.gpgsign true` and 1Password (or another
signing helper) is timing out. The test fixtures isolate via
`GIT_CONFIG_GLOBAL=/dev/null`, so this only affects ad-hoc commits in
your own terminal, not the suite. If you see it in the suite, file a
bug — there's likely an env-leak.

### Electron window is invisible / appears off-screen

Reset the window position by quitting the app and removing
`~/Library/Application Support/treeline-app/config.json`. (Be aware
this also drops your added repos.)

### MODULE_TYPELESS_PACKAGE_JSON warning

Harmless. `postcss.config.js` uses ESM syntax without `"type": "module"`
in `package.json`. Adding the field would silence the warning but
require renaming `.eslintrc.cjs` rules around CJS configs; not worth
the churn for v1.

## Adding a feature

The IPC contract (`src/shared/ipc-contract.ts`) is the canonical place
to start. Adding a feature usually means:

1. Add the new method or event to `TreelineApi`.
2. Add a string constant in `src/shared/ipc-channels.ts`.
3. Implement the handler in `src/main/ipc/<domain>.ts`. Register it in
   `src/main/index.ts`.
4. Add the bridge call in `src/preload/index.ts`.
5. Wire it in the renderer (a Zustand action, a component, etc.).
6. Test where it makes sense — `src/main` modules are unit-tested with
   vitest; renderer code is verified manually for v1.

If your feature needs filesystem watching or polling, use the existing
`WorktreeWatcher` / `TerminalStatusMonitor` / `ProcessMonitor`
patterns — they already handle dispose, debouncing, and broadcast.
