// Autonomous end-to-end harness for PER-PANE Claude session pinning: multiple
// tabs — including two tabs in the SAME directory — each restore their OWN
// conversation after a full restart.
//
// The per-cwd heuristic (newest transcript for the pane's directory) cannot
// tell two tabs in one directory apart, and is stolen by any newer transcript
// written there by anything else. The fix: a SessionStart hook reports each
// pane's ACTUAL session id ({TREELINE_PANE_ID → session_id}) over the CLI
// socket, and the save path pins per pane. This harness exercises that whole
// chain with zero mocks inside the app:
//   1. builds a throwaway git repo with two worktrees,
//   2. seeds a DECOY transcript (newest mtime) in each worktree's Claude
//      project folder under a redirected $HOME — the id the OLD per-cwd
//      behavior would pin; nothing may resume it,
//   3. puts a compiled `claude` stub on PATH that behaves like the real thing:
//      invents a unique session id, prints it, and reports it through the real
//      hook path (`treeline.mjs claude-session` → unix socket → PtyManager),
//      exactly as the SessionStart hook does — TREELINE_PANE_ID comes from the
//      pane's env, the socket from TREELINE_SOCK,
//   4. opens THREE tabs — two in worktree A (same cwd!), one in worktree B —
//      and runs `claude` in each,
//   5. lets the status monitor + debounced save land, asserts session.json
//      pinned each pane's OWN reported id (the same-cwd pair distinct; the
//      decoy nowhere),
//   6. fully quits, relaunches, restores, and verifies every pane re-issued
//      `claude --resume <its-own-id>` — same-cwd tabs included.
//
// Run:  npm run build && node tests/e2e/restart-per-pane-sessions-harness.mjs

import { _electron as electron } from 'playwright';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  realpathSync,
  utimesSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MAIN = join(ROOT, 'out', 'main', 'index.js');
const CLI_JS = join(ROOT, 'bin', 'treeline.mjs');
const log = (...a) => console.log(...a);

// Same source-derived encoder as restart-claude-worktrees-harness.mjs — the
// harness must agree with the app about the projects-folder name or the decoy
// lands somewhere the app never looks (and the test silently proves nothing).
function loadEncodeProjectDir() {
  const src = readFileSync(join(ROOT, 'src', 'main', 'claude-session.ts'), 'utf8');
  const m = src.match(
    /export function encodeProjectDir[\s\S]*?return cwd\.replace\((\/[^\n]*?\/[a-z]*),\s*'-'\)/,
  );
  if (!m) {
    throw new Error(
      'harness: could not extract encodeProjectDir regex from src/main/claude-session.ts — ' +
        'the source shape changed; update loadEncodeProjectDir().',
    );
  }
  const lit = m[1];
  const lastSlash = lit.lastIndexOf('/');
  const re = new RegExp(lit.slice(1, lastSlash), lit.slice(lastSlash + 1));
  return (cwd) => cwd.replace(re, '-');
}
const encodeProjectDir = loadEncodeProjectDir();

const CONV = '{"type":"user","text":"hi"}\n{"type":"assistant","text":"yo"}\n';

const git = (cwd, ...args) =>
  execFileSync('git', args, {
    cwd,
    stdio: 'pipe',
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
  });

// ── fixtures ────────────────────────────────────────────────────────────────
function buildRepoWithWorktrees(codeRoot) {
  const repo = join(codeRoot, 'api');
  mkdirSync(repo, { recursive: true });
  git(repo, 'init', '--quiet', '--initial-branch', 'main');
  git(repo, 'config', 'user.name', 'Test User');
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(repo, 'README.md'), '# api\n');
  git(repo, 'add', 'README.md');
  git(repo, 'commit', '--quiet', '--no-gpg-sign', '-m', 'init');

  const worktrees = [];
  for (const [branch, dir] of [
    ['feature/auth', 'auth-worktree'],
    ['feature/api-v2', 'api-v2-worktree'],
  ]) {
    git(repo, 'branch', branch, 'main');
    const wtPath = join(repo, dir);
    git(repo, 'worktree', 'add', '--quiet', wtPath, branch);
    worktrees.push(realpathSync(wtPath));
  }
  return { repo: realpathSync(repo), worktrees };
}

// A compiled `claude` (basename must be literally "claude" for the status
// monitor). Mimics the real thing's session behavior:
//   • fresh start → invents a unique session id (sess-live-<pid>),
//   • `--resume <id>` → adopts that id (a resumed session keeps its id),
// then prints the id (observable via xterm) and reports it through the REAL
// SessionStart-hook path: `node treeline.mjs claude-session <id>`, with
// TREELINE_PANE_ID and TREELINE_SOCK inherited from the pane env. Blocks so it
// stays the pane's foreground process.
function buildClaudeStub(binDir) {
  mkdirSync(binDir, { recursive: true });
  const src = join(binDir, 'claude.c');
  writeFileSync(
    src,
    `#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
int main(int argc, char** argv) {
  const char* resume = NULL;
  for (int i = 1; i + 1 < argc; i++) {
    if (strcmp(argv[i], "--resume") == 0) resume = argv[i + 1];
  }
  printf("CLAUDE_STUB args:");
  for (int i = 1; i < argc; i++) printf(" %s", argv[i]);
  printf("\\n");
  char id[128];
  if (resume) snprintf(id, sizeof id, "%s", resume);
  else snprintf(id, sizeof id, "sess-live-%d", (int)getpid());
  printf("CLAUDE_STUB session %s\\n", id);
  fflush(stdout);
  const char* node = getenv("NODE_BIN");
  const char* cli = getenv("TREELINE_CLI_JS");
  if (node && cli) {
    char cmd[1024];
    snprintf(cmd, sizeof cmd, "\\"%s\\" \\"%s\\" claude-session \\"%s\\" >/dev/null 2>&1",
             node, cli, id);
    system(cmd);
  }
  pause();
  return 0;
}
`,
  );
  execFileSync('cc', ['-o', join(binDir, 'claude'), src], { stdio: 'pipe' });
}

function seedTranscript(home, cwd, sessionId, content, mtimeSec) {
  const dir = join(home, '.claude', 'projects', encodeProjectDir(cwd));
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${sessionId}.jsonl`);
  writeFileSync(file, content);
  utimesSync(file, mtimeSec, mtimeSec);
}

// ── playwright helpers ──────────────────────────────────────────────────────
const allXtermText = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.xterm-rows')].map((el) =>
      el.innerText.replace(/\s+/g, ' ').trim(),
    ),
  );

const tabTitles = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('[role="tab"]')].map((el) =>
      el.innerText.replace(/\s+/g, ' ').trim(),
    ),
  );

async function waitStable(page, quietMs = 700, timeoutMs = 10000) {
  const start = Date.now();
  let last = '';
  let lastChange = Date.now();
  while (Date.now() - start < timeoutMs) {
    const t = (await allXtermText(page)).join('|');
    if (t !== last) {
      last = t;
      lastChange = Date.now();
    } else if (Date.now() - lastChange >= quietMs && t.trim().length > 0) return;
    await page.waitForTimeout(100);
  }
}

/** Text of the active tab's (only visible) pane. */
async function activePaneText(page) {
  return (await allXtermText(page)).find((s) => s.length > 0) ?? '';
}

const leavesOf = (node) => (node.kind === 'leaf' ? [node] : node.children.flatMap(leavesOf));

async function main() {
  const userDataDir = mkdtempSync(join(tmpdir(), 'treeline-pp-data-'));
  const home = mkdtempSync(join(tmpdir(), 'treeline-pp-home-'));
  const codeRoot = realpathSync(mkdtempSync(join(tmpdir(), 'treeline-pp-code-')));
  const binDir = join(home, 'bin');
  const sessionPath = join(userDataDir, 'session.json');
  const findings = [];

  const { repo, worktrees } = buildRepoWithWorktrees(codeRoot);
  const [wtA, wtB] = worktrees;
  buildClaudeStub(binDir);

  // The decoy: newest transcript in each worktree's project folder. The OLD
  // per-cwd behavior would pin this id onto every claude pane in that cwd; the
  // per-pane fix must never touch it. (An older conversation sits alongside so
  // the folder looks lived-in.)
  const decoyIds = { [wtA]: 'decoy-auth-9999ZZZZ', [wtB]: 'decoy-apiv2-9999ZZZZ' };
  for (const wt of worktrees) {
    seedTranscript(home, wt, 'old-history-0000AAAA', CONV, 1000);
    seedTranscript(home, wt, decoyIds[wt], CONV, 9000); // newest → the per-cwd pick
  }

  writeFileSync(
    join(userDataDir, 'config.json'),
    JSON.stringify({
      schemaVersion: 4,
      codeRoot: null,
      sidebarCollapsed: false,
      repos: [{ path: repo, name: 'api', addedAt: Date.now() }],
      folders: [],
    }),
  );

  const env = {
    ...process.env,
    HOME: home,
    PATH: `${binDir}:${process.env.PATH}`,
    // The app's CLI socket, pinned somewhere the stub can find it (panes
    // inherit the app env; treeline.mjs honours the same override).
    TREELINE_SOCK: join(userDataDir, 'cli.sock'),
    // How the stub reaches the CLI: the node running this harness + the repo's
    // treeline.mjs (in a packaged build the hook uses the app's launcher shim).
    NODE_BIN: process.execPath,
    TREELINE_CLI_JS: CLI_JS,
  };
  const launch = () =>
    electron.launch({
      args: [MAIN, '--no-sandbox', '--disable-gpu', `--user-data-dir=${userDataDir}`],
      env,
    });

  // Tab plan: two tabs in wtA (the same-project case) + one in wtB.
  const tabCwds = [wtA, wtA, wtB];

  log('Fixtures:');
  log('  repo          :', repo);
  log('  worktree A ×2 :', wtA, ' decoy:', decoyIds[wtA]);
  log('  worktree B ×1 :', wtB, ' decoy:', decoyIds[wtB]);

  // ─── PHASE 1: three tabs (two sharing a cwd), claude in each, save lands ───
  let app = await launch();
  let page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('[data-ss="worktree-row"]', { timeout: 15000 });

  // Tab 0: worktree A via its sidebar row.
  await page.locator(`[data-ss-path="${wtA}"] button[title="${wtA}"]`).first().click();
  await page.waitForTimeout(400);
  // Tab 1: SAME worktree via the tab-strip "+" (forceNew — the row button would
  // just refocus the existing tab).
  await page.locator('button[title^="New tab on"]').click();
  await page.waitForTimeout(400);
  // Tab 2: worktree B via its sidebar row.
  await page.locator(`[data-ss-path="${wtB}"] button[title="${wtB}"]`).first().click();
  await page.waitForTimeout(400);

  await page.waitForSelector('.xterm-rows', { state: 'attached', timeout: 15000 });
  await waitStable(page);

  const tabs = await tabTitles(page);
  log('');
  log('PHASE 1 — tabs opened:', JSON.stringify(tabs));
  findings.push(['three tabs opened (two on the same worktree)', tabs.length === 3]);

  // Run the stub in every tab; harvest the session id each pane invented.
  const ids = [];
  for (let i = 0; i < tabCwds.length; i++) {
    await page.locator('[role="tab"]').nth(i).click();
    await page.waitForTimeout(300);
    await page.locator('.xterm-screen:visible').first().click();
    await page.keyboard.insertText('claude');
    await page.waitForTimeout(120);
    await page.keyboard.press('Enter');
    // The stub prints its id immediately; poll this pane until it shows.
    let id = null;
    for (let tries = 0; tries < 30 && !id; tries++) {
      await page.waitForTimeout(200);
      const m = (await activePaneText(page)).match(/CLAUDE_STUB session (\S+)/);
      if (m) id = m[1];
    }
    ids.push(id);
    log(`  tab[${i}] (${tabCwds[i].split('/').pop()}) session:`, id);
  }
  findings.push(['every pane printed a session id', ids.every(Boolean)]);
  findings.push(['the same-cwd pair invented DISTINCT ids', !!ids[0] && ids[0] !== ids[1]]);

  // Status monitor tick (~2s) flips each pane's foregroundCmd to `claude`,
  // then the debounced (750ms) save pins ids per pane and writes session.json.
  await page.waitForTimeout(5000);

  const saved = existsSync(sessionPath) ? JSON.parse(readFileSync(sessionPath, 'utf8')) : null;
  const savedTabs = saved?.tabs ?? [];
  log('  session.json tabs:', savedTabs.length);
  const pinned = savedTabs.map((t) => {
    const claude = leavesOf(t.root).filter((l) => l.claudePane);
    return claude[0]?.claudeSessionId ?? null;
  });
  savedTabs.forEach((t, i) =>
    log(`    • tab[${i}] ${t.cwd}  pinned=${pinned[i] ?? '<none>'}`),
  );

  findings.push(['three tabs persisted', savedTabs.length === 3]);
  findings.push([
    'saved tab order matches the opened cwds',
    savedTabs.length === 3 && savedTabs.every((t, i) => t.cwd === tabCwds[i]),
  ]);
  findings.push([
    'each pane pinned ITS OWN reported id (per-pane, not per-cwd)',
    pinned.length === 3 && pinned.every((p, i) => p === ids[i]),
  ]);
  findings.push([
    'the same-cwd tabs pinned different ids',
    !!pinned[0] && !!pinned[1] && pinned[0] !== pinned[1],
  ]);
  findings.push([
    'the decoy (newest transcript in the cwd) was pinned nowhere',
    pinned.every((p) => p !== decoyIds[wtA] && p !== decoyIds[wtB]),
  ]);

  await app.close();
  log('  → full quit (PTYs + claude stubs killed)');

  // ─── PHASE 2: relaunch, restore, each pane resumes its own conversation ────
  app = await launch();
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');

  const dialog = page.getByRole('dialog', { name: 'Restore previous session' });
  const promptShown = await dialog
    .waitFor({ state: 'visible', timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  log('');
  log('PHASE 2 — RestorePrompt shown:', promptShown);
  findings.push(['RestorePrompt offered on cold start', promptShown]);

  if (promptShown) {
    await page.getByRole('button', { name: 'Restore' }).click();
    await page.waitForSelector('.xterm-rows', { state: 'attached', timeout: 15000 }).catch(() => {});
    // Respawn 3 shells; each types `claude --resume <pinned-id>` when ready.
    await page.waitForTimeout(6000);

    log('  restored tabs:', JSON.stringify(await tabTitles(page)));
    const restoredCount = (await tabTitles(page)).length;
    findings.push(['all three tabs restored', restoredCount === 3]);

    for (let i = 0; i < restoredCount; i++) {
      await page.locator('[role="tab"]').nth(i).click();
      await page.waitForTimeout(400);
      const text = await activePaneText(page);
      log(`    xterm[${i}]:`, JSON.stringify(text.slice(0, 110)));
      findings.push([
        `tab[${i}] resumed its own session ${ids[i]}`,
        text.includes(`--resume ${ids[i]}`),
      ]);
    }
    const decoyResumed = (await allXtermText(page)).some(
      (t) => t.includes(`--resume ${decoyIds[wtA]}`) || t.includes(`--resume ${decoyIds[wtB]}`),
    );
    findings.push(['no pane resumed the decoy session', !decoyResumed]);
  }

  await app.close();

  // ─── Report ───────────────────────────────────────────────────────────────
  log('');
  log('════════════════ FINDINGS ════════════════');
  for (const [label, ok] of findings) log(`  ${ok ? '✅' : '❌'}  ${label}`);
  if (findings.length === 0) log('  ❌  no findings recorded — the harness asserted nothing');
  const pass = findings.length > 0 && findings.every((f) => f[1]);
  log('═══════════════════════════════════════════');
  log('RESULT:', pass ? 'PASS ✅' : 'FAIL ❌');
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error('HARNESS ERROR:', err);
  process.exit(2);
});
