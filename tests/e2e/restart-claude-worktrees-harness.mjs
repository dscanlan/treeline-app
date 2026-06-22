// Autonomous end-to-end harness for "restart with multiple Claude sessions in
// worktrees" (full process restart + cold-start session restore, v0.17.0).
//
// This is the worktree/Claude analogue of restart-scratch-harness.mjs. It:
//   1. builds a throwaway git repo with two worktrees under an underscore-bearing
//      parent dir (so the cwd→project-folder encoding fix is exercised),
//   2. seeds, per worktree, a real conversation transcript PLUS a newer
//      non-conversation stub, both under a redirected $HOME (so nothing touches
//      your real ~/.claude) — restore must pick the real one and skip the stub,
//   3. puts a tiny compiled `claude` stub on PATH so a pane's foreground command
//      is literally `claude` (the exact string the save path keys on) — a shell
//      script would report its interpreter (`bash`), not `claude`,
//   4. opens a terminal in each worktree and runs `claude` there,
//   5. lets the status monitor + the debounced (750ms) save land, asserts
//      session.json captured each pane as a Claude pane WITH its pinned session
//      id (resolved by cwd at save time),
//   6. fully quits, relaunches the same userDataDir, restores, and verifies each
//      pane respawned and re-issued `claude --resume <that-exact-id>`.
//
// Run:  npm run build && node tests/e2e/restart-claude-worktrees-harness.mjs

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
const log = (...a) => console.log(...a);

// The encoder, derived from the single source of truth so this harness can never
// silently disagree with the app under test (the previous inline copy drifted —
// it still used the old `/[/.]/g` after the app moved to `/[^a-zA-Z0-9]/g`). We
// can't `import` it: the main bundle in out/main/index.js pulls in Electron and
// boots the app on import. So extract the regex literal from the source; if its
// shape ever changes, this throws loudly rather than testing against a stale copy.
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
  const lit = m[1]; // e.g. "/[^a-zA-Z0-9]/g"
  const lastSlash = lit.lastIndexOf('/');
  const re = new RegExp(lit.slice(1, lastSlash), lit.slice(lastSlash + 1));
  return (cwd) => cwd.replace(re, '-');
}
const encodeProjectDir = loadEncodeProjectDir();

// A resumable conversation has at least one `assistant` turn; a non-conversation
// stub (a `/model`/bridge-session marker) has none. The fix skips stubs even when
// they carry the NEWEST mtime — resolving one is what opened a blank `--resume`.
const CONV = '{"type":"user","text":"hi"}\n{"type":"assistant","text":"yo"}\n';
const STUB = '{"type":"user"}\n{"type":"bridge-session"}\n{"type":"mode"}\n';

const git = (cwd, ...args) =>
  execFileSync('git', args, {
    cwd,
    stdio: 'pipe',
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
  });

// ── fixtures ────────────────────────────────────────────────────────────────
function buildRepoWithWorktrees(codeRoot) {
  // Nest the repo under an underscore-bearing parent so every worktree path
  // contains `_`. This exercises the encoding fix end-to-end: pre-fix the app
  // looked under `...my_org...` (underscore kept) while Claude stores it as
  // `...my-org...`, so the seeded transcript was never found.
  const repo = join(codeRoot, 'my_org', 'api');
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
    worktrees.push(realpathSync(wtPath)); // canonical path = what lsof will report
  }
  return { repo: realpathSync(repo), worktrees };
}

// A compiled `claude` so the process image's basename is exactly "claude".
// Prints its args (so `--resume <id>` is observable) then blocks so it stays the
// pane's foreground process for the status monitor to catch.
function buildClaudeStub(binDir) {
  mkdirSync(binDir, { recursive: true });
  const src = join(binDir, 'claude.c');
  writeFileSync(
    src,
    `#include <stdio.h>
#include <unistd.h>
int main(int argc, char** argv) {
  printf("CLAUDE_STUB args:");
  for (int i = 1; i < argc; i++) printf(" %s", argv[i]);
  printf("\\n");
  fflush(stdout);
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
  utimesSync(file, mtimeSec, mtimeSec); // pin mtime so "newest" is deterministic
}

// ── playwright helpers ──────────────────────────────────────────────────────
const xtermTextFor = (page, ptyIndex) =>
  page.evaluate((i) => {
    const els = [...document.querySelectorAll('.xterm-rows')];
    return els[i] ? els[i].innerText : '';
  }, ptyIndex);

const allXtermText = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.xterm-rows')].map((el) => el.innerText.replace(/\s+/g, ' ').trim()),
  );

const tabTitles = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('[role="tab"]')].map((el) => el.innerText.replace(/\s+/g, ' ').trim()),
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

const leavesOf = (node) =>
  node.kind === 'leaf' ? [node] : node.children.flatMap(leavesOf);

async function main() {
  const userDataDir = mkdtempSync(join(tmpdir(), 'treeline-cw-data-'));
  const home = mkdtempSync(join(tmpdir(), 'treeline-cw-home-'));
  const codeRoot = realpathSync(mkdtempSync(join(tmpdir(), 'treeline-cw-code-')));
  const binDir = join(home, 'bin');
  const sessionPath = join(userDataDir, 'session.json');
  const findings = [];

  const { repo, worktrees } = buildRepoWithWorktrees(codeRoot);
  buildClaudeStub(binDir);

  // Per worktree: a real conversation (OLDER) that restore must resume, plus a
  // non-conversation stub (NEWER) that must be skipped. Pre-fix, "newest mtime
  // wins" would pick the stub and `--resume` it into a blank session.
  const sessionIds = { [worktrees[0]]: 'sess-auth-AAAA1111', [worktrees[1]]: 'sess-apiv2-BBBB2222' };
  const stubIds = { [worktrees[0]]: 'stub-auth-9999ZZZZ', [worktrees[1]]: 'stub-apiv2-9999ZZZZ' };
  for (const wt of worktrees) {
    seedTranscript(home, wt, sessionIds[wt], CONV, 1000); // older, real conversation
    seedTranscript(home, wt, stubIds[wt], STUB, 9000); // newer, stub → must be skipped
  }

  // Pre-add the repo so the sidebar lists its worktrees on launch.
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

  const env = { ...process.env, HOME: home, PATH: `${binDir}:${process.env.PATH}` };
  const launch = () =>
    electron.launch({
      args: [MAIN, '--no-sandbox', '--disable-gpu', `--user-data-dir=${userDataDir}`],
      env,
    });

  log('Fixtures:');
  log('  repo      :', repo);
  for (const wt of worktrees)
    log('  worktree  :', wt, '→ resume', sessionIds[wt], '(skip newer stub', stubIds[wt] + ')');

  // Genuine encoding-regression guard (the round trip co-moves with source, so
  // assert the derived encoder still replaces underscores the way the fix does).
  findings.push([
    'encoder replaces underscores like Claude (encoding fix in place)',
    encodeProjectDir('/Users/me/obsidian_notes') === '-Users-me-obsidian-notes',
  ]);

  // ─── PHASE 1: open a terminal per worktree, run claude, let save land ──────
  let app = await launch();
  let page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('[data-ss="worktree-row"]', { timeout: 15000 });

  for (const wt of worktrees) {
    // The worktree-row's open-terminal button carries title === the path.
    await page.locator(`[data-ss-path="${wt}"] button[title="${wt}"]`).first().click();
    await page.waitForTimeout(400);
  }
  await page.waitForSelector('.xterm-rows', { state: 'attached', timeout: 15000 });
  await waitStable(page);

  // Run the claude stub in each pane. Click the tab, focus its terminal, type.
  const tabs = await tabTitles(page);
  log('');
  log('PHASE 1 — tabs opened:', JSON.stringify(tabs));
  for (let i = 0; i < worktrees.length; i++) {
    const tab = page.locator('[role="tab"]').nth(i);
    await tab.click();
    await page.waitForTimeout(300);
    await page.locator('.xterm-screen:visible').first().click();
    await page.keyboard.insertText('claude');
    await page.waitForTimeout(120);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
  }

  // The status monitor ticks ~2s; give it room to mark each pane foreground
  // 'claude', then the debounced 750ms save to pin ids + write session.json.
  await page.waitForTimeout(5000);

  let saved = existsSync(sessionPath) ? JSON.parse(readFileSync(sessionPath, 'utf8')) : null;
  const savedLeaves = (saved?.tabs ?? []).flatMap((t) => leavesOf(t.root));
  const claudeLeaves = savedLeaves.filter((l) => l.claudePane);
  log('  session.json tabs        :', saved?.tabs?.length ?? 0);
  log('  leaves flagged claudePane:', claudeLeaves.length);
  for (const l of savedLeaves) {
    log(`    • ${l.cwd}  claudePane=${l.claudePane}  id=${l.claudeSessionId ?? '<none>'}`);
  }

  findings.push(['two worktree tabs persisted', (saved?.tabs?.length ?? 0) === 2]);
  findings.push(['both panes flagged as Claude panes', claudeLeaves.length === 2]);
  const idsPinnedRight = worktrees.every((wt) =>
    savedLeaves.some((l) => l.cwd === wt && l.claudeSessionId === sessionIds[wt]),
  );
  findings.push(['each pane pinned the correct session id (by cwd)', idsPinnedRight]);
  const stubsSkipped = worktrees.every((wt) =>
    savedLeaves.every((l) => l.claudeSessionId !== stubIds[wt]),
  );
  findings.push(['the newer non-conversation stub was skipped (no stub id pinned)', stubsSkipped]);

  await app.close();
  log('  → full quit (PTYs + claude stubs killed)');

  // ─── PHASE 2: relaunch, restore, verify each resumes its own conversation ──
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
  if (promptShown) log('  prompt text:', JSON.stringify((await dialog.innerText()).replace(/\s+/g, ' ').trim()));
  findings.push(['RestorePrompt offered on cold start', promptShown]);

  if (promptShown) {
    await page.getByRole('button', { name: 'Restore' }).click();
    await page.waitForSelector('.xterm-rows', { state: 'attached', timeout: 15000 }).catch(() => {});
    // Respawn 2 shells, each writes `claude --resume <id>` once its shell is ready.
    await page.waitForTimeout(6000);

    // innerText is '' for a hidden (inactive) tab's xterm, so click each tab to
    // make its pane visible before reading. Collect the text of every pane.
    log('  restored panes:', JSON.stringify(await tabTitles(page)));
    const texts = [];
    const tabCount = (await tabTitles(page)).length;
    for (let i = 0; i < tabCount; i++) {
      await page.locator('[role="tab"]').nth(i).click();
      await page.waitForTimeout(400);
      const t = ((await allXtermText(page)).find((s) => s.length > 0)) ?? '';
      texts.push(t);
      log(`    xterm[${i}]:`, JSON.stringify(t.slice(0, 90)));
    }

    const blob = texts.join('\n');
    for (const wt of worktrees) {
      const id = sessionIds[wt];
      const short = wt.split('/').pop();
      findings.push([`pane for ${short} resumed ${id}`, blob.includes(`--resume ${id}`)]);
      findings.push([
        `pane for ${short} did NOT resume the stub`,
        !blob.includes(`--resume ${stubIds[wt]}`),
      ]);
    }
  }

  await app.close();

  // ─── Report ───────────────────────────────────────────────────────────────
  log('');
  log('════════════════ FINDINGS ════════════════');
  for (const [label, ok] of findings) log(`  ${ok ? '✅' : '❌'}  ${label}`);
  // A run that recorded no findings asserted nothing — fail loudly rather than
  // report a vacuous PASS (findings.every is true for an empty array).
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
