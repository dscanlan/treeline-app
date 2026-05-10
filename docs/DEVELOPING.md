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

The build is currently unsigned, which means downloaded `.dmg`s hit
Gatekeeper's *"Apple could not verify…"* wall on Sequoia and need the
`xattr -dr com.apple.quarantine …` workaround documented in the
[README](../README.md#pre-built-recommended). Signing fixes that. The
full path:

### 1. Prerequisites

You need an active **Apple Developer Program** membership ($99/year)
and a **Developer ID Application** certificate. The "Apple Development"
cert that ships with a normal Apple ID does *not* work — Gatekeeper
specifically requires Developer ID.

1. developer.apple.com → Certificates → `+` → **Developer ID Application**.
2. Follow the prompts to generate a CSR in Keychain Access, upload it,
   download the resulting `.cer`, double-click to install.

### 2. Export the cert + private key as `.p12`

In Keychain Access:

1. Find the new **Developer ID Application: <your name>** entry.
2. Expand the disclosure triangle — there must be a private key
   underneath. If there isn't, the keychain doesn't have the matching
   key and you need to re-do the CSR/import on the same machine.
3. Right-click the cert → **Export "Developer ID Application: …"**.
4. Format: **Personal Information Exchange (.p12)**.
5. Set a strong password — you'll need it as `CSC_KEY_PASSWORD`.

### 3. Base64-encode the `.p12` for GitHub secrets

GitHub secrets are plain text, so binary data has to be encoded:

```bash
base64 -i ~/Downloads/developer-id.p12 | pbcopy
```

The clipboard now has the value for `CSC_LINK`.

### 4. App-specific password for notarization

1. appleid.apple.com → **Sign-In and Security** → **App-Specific
   Passwords**.
2. **Generate Password** → label it `treeline-app notarization`.
3. The 19-char string is `APPLE_APP_SPECIFIC_PASSWORD`.

### 5. Find your Team ID

developer.apple.com → **Membership Details** → 10-character Team ID at
the top.

### 6. Add the secrets

Repo on GitHub → **Settings → Secrets and variables → Actions → New
repository secret**. Add five:

| Name | Value |
| ---- | ----- |
| `CSC_LINK` | base64 contents of the `.p12` (from step 3) |
| `CSC_KEY_PASSWORD` | password you set on the `.p12` (step 2) |
| `APPLE_ID` | your Apple Developer account email |
| `APPLE_APP_SPECIFIC_PASSWORD` | from step 4 |
| `APPLE_TEAM_ID` | from step 5 |

### 7. Switch the workflow on

In `.github/workflows/release.yml`, replace:

```yaml
env:
  CSC_IDENTITY_AUTO_DISCOVERY: 'false'
```

with:

```yaml
env:
  CSC_LINK: ${{ secrets.CSC_LINK }}
  CSC_KEY_PASSWORD: ${{ secrets.CSC_KEY_PASSWORD }}
  APPLE_ID: ${{ secrets.APPLE_ID }}
  APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}
  APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
```

Push, tag a new version, and the workflow will:

1. Build the app and `.dmg` as before.
2. Sign every binary inside with the Developer ID cert.
3. Submit the `.dmg` to Apple's notarization service via `notarytool`.
4. Wait for the notary verdict (~3–10 minutes).
5. Staple the notarization ticket to the `.dmg` so first launch works
   even offline.

`hardenedRuntime: true` and `resources/entitlements.mac.plist` are
already configured in `electron-builder.yml`, so no further changes
needed there.

### Things that go wrong

- **`Code signing failed: no identity matching`** — the cert in the
  `.p12` isn't a "Developer ID Application" cert, it's "Apple
  Development" or similar. Re-do step 1 with the right cert type.
- **Notarization rejected** with `errors: [{ code: 4000 }]` — your
  entitlements include a JIT key (we do, for V8) without
  `com.apple.security.cs.allow-unsigned-executable-memory`. Already
  present in `resources/entitlements.mac.plist`; if you change it,
  re-check both entries.
- **`Unable to find a matching keychain`** — usually transient; the
  `CSC_LINK` decode placed the cert into a temp keychain that
  electron-builder couldn't find. Retry the workflow.
- **Notarization stuck "in progress" for >30 min** — Apple's notary
  service is slow some days. The workflow will eventually time out
  (after 30 min). Re-run.

### Reverting

If something breaks and you need to ship an unsigned build to unblock
yourself, replace the env block with `CSC_IDENTITY_AUTO_DISCOVERY:
'false'` again — that's the documented escape hatch.

## Updating screenshots

Two paths, pick by what you need:

```bash
# Automated. Builds, then headlessly captures every scenario in
# src/main/screenshot.ts via webContents.capturePage(). Best for the
# bulk of the README shots (sidebar, modals, hover states, scratch).
./scripts/take-screenshots-auto.sh

# Interactive. Walks you through each shot, prompting before each
# capture. Use this when you need the native chrome (traffic lights,
# rounded corners, shadow) that capturePage() doesn't include.
./scripts/launch-with-test-scenario.sh   # in one terminal
./scripts/take-screenshots.sh            # in another
```

PNGs land in `docs/img/` with stable filenames the README references.
To add a new scenario, register it in `src/main/screenshot.ts`
(`SCENARIOS` map) and append its id to `ALL_SCENARIOS` in
`scripts/take-screenshots-auto.sh`. The harness now always calls
`app.exit` even when a scenario throws, so a broken selector fails
fast instead of stranding the loop.

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

### "Unable to load preload script: module not found: node:os"

The preload runs with `sandbox: true` (see `webPreferences` in
`src/main/index.ts`), which **bans Node built-ins** — `node:os`,
`node:path`, `node:fs`, etc. all throw at preload load time, which
cascades into a renderer crash and an empty `window.treeline`. The
fix is to pass the value in from main via
`webPreferences.additionalArguments` and read it from `process.argv`
inside the preload (`process` IS available in the sandbox). The
existing `system.homeDir` exposure is the reference implementation
of that pattern.

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
