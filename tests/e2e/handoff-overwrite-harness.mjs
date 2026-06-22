// Autonomous end-to-end harness for the "multiple worktrees from one Claude
// session" handoff bug (fix/worktree-handoff-overwrite).
//
// The bug: `resumeSessionInWorktree` keys the park↔fork Handoff record by the
// ORIGIN pty id. If the same agent creates several worktrees and you click
// "Continue Claude in new tab" on more than one, the second resume re-parks the
// same origin pane and OVERWRITES the first handoff — orphaning the first fork
// and letting the origin thaw while that fork still runs. The fix refuses the
// second resume (a session can only be handed off to one worktree at a time).
//
// This harness:
//   1. builds a throwaway repo (main checkout only) under a redirected $HOME,
//      seeds one fake `claude` transcript in the repo's project folder so
//      `prepareResume` finds a session, and puts a compiled `claude` stub on PATH,
//   2. opens a terminal in the repo (the ORIGIN pane — a real, parkable pty),
//   3. creates two worktrees on disk; the WorktreeWatcher broadcasts both as
//      "Continue Claude in <wt>?" toasts (the first change per repo seeds the
//      known-set silently, so worktrees created AFTER launch both surface),
//   4. clicks "Continue Claude in new tab" on the first toast → asserts a fork
//      tab opened and the origin pane is parked (the "Session paused" overlay
//      naming that first worktree),
//   5. clicks "Continue Claude in new tab" on the second toast → asserts it is
//      REFUSED: the toast shows an "already continuing" error, NO second fork
//      tab is created, and the origin overlay still names the FIRST worktree.
//
// Without the fix, step 5 would open a second fork and flip the overlay to the
// second worktree. With it, the conversation stays handed off to exactly one.
//
// Run:  npm run build && node tests/e2e/handoff-overwrite-harness.mjs

import { _electron as electron } from 'playwright';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  realpathSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MAIN = join(ROOT, 'out', 'main', 'index.js');
const log = (...a) => console.log(...a);
const encodeProjectDir = (cwd) => cwd.replace(/[/.]/g, '-'); // mirrors claude-session.ts

const git = (cwd, ...args) =>
  execFileSync('git', args, {
    cwd,
    stdio: 'pipe',
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
  });

// ── fixtures ────────────────────────────────────────────────────────────────
function buildRepo(codeRoot) {
  const repo = join(codeRoot, 'api');
  mkdirSync(repo, { recursive: true });
  git(repo, 'init', '--quiet', '--initial-branch', 'main');
  git(repo, 'config', 'user.name', 'Test User');
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(repo, 'README.md'), '# api\n');
  git(repo, 'add', 'README.md');
  git(repo, 'commit', '--quiet', '--no-gpg-sign', '-m', 'init');
  return realpathSync(repo);
}

// A compiled `claude` so the fork's process image basename is exactly "claude".
// Prints its args then blocks so it stays the pane's foreground process.
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

function seedTranscript(home, cwd, sessionId) {
  const dir = join(home, '.claude', 'projects', encodeProjectDir(cwd));
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${sessionId}.jsonl`),
    JSON.stringify({ type: 'summary', summary: `fixture ${sessionId}` }) + '\n',
  );
}

// ── playwright helpers ──────────────────────────────────────────────────────
const tabTitles = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('[role="tab"]')].map((el) =>
      el.innerText.replace(/\s+/g, ' ').trim(),
    ),
  );

// Text of the parked-overlay card ("Session paused" + "Keep working in <wt>"),
// scoped to the card (via its unique "Keep working in" button) and read via
// textContent so it's legible even when its tab is hidden.
const parkedOverlayText = (page) =>
  page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Keep working in'),
    );
    const card = btn?.closest('.max-w-sm') ?? btn;
    return card?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  });

async function main() {
  const userDataDir = mkdtempSync(join(tmpdir(), 'treeline-ho-data-'));
  const home = mkdtempSync(join(tmpdir(), 'treeline-ho-home-'));
  const codeRoot = realpathSync(mkdtempSync(join(tmpdir(), 'treeline-ho-code-')));
  const binDir = join(home, 'bin');
  const findings = [];

  const repo = buildRepo(codeRoot);
  buildClaudeStub(binDir);
  seedTranscript(home, repo, 'sess-origin-AAAA1111');

  // Worktrees we'll create at runtime (after launch) so both broadcast a toast.
  const wtA = join(repo, 'wt-a');
  const wtB = join(repo, 'wt-b');

  // Pre-add the repo so the sidebar lists it (and its main checkout row) on launch.
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
  const app = await electron.launch({
    args: [MAIN, '--no-sandbox', '--disable-gpu', `--user-data-dir=${userDataDir}`],
    env,
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('[data-ss="worktree-row"]', { timeout: 15000 });

  log('Fixtures:');
  log('  repo (origin):', repo);
  log('  worktree A   :', wtA);
  log('  worktree B   :', wtB);

  // ─── Open the ORIGIN terminal in the repo (the parkable pty) ───────────────
  await page.locator(`[data-ss-path="${repo}"] button[title="${repo}"]`).first().click();
  await page.waitForSelector('.xterm-rows', { state: 'attached', timeout: 15000 });
  await page.waitForTimeout(1500); // let the watcher's initial seed settle ({repo})

  let tabs = await tabTitles(page);
  log('');
  log('Origin tab opened:', JSON.stringify(tabs));
  findings.push(['origin terminal opened (1 tab)', tabs.length === 1]);

  // ─── Create two worktrees → two created-worktree toasts ────────────────────
  git(repo, 'worktree', 'add', '--quiet', wtA, '-b', 'feature/aaa');
  await page.waitForTimeout(2500); // watcher debounce + listWorktrees + broadcast
  git(repo, 'worktree', 'add', '--quiet', wtB, '-b', 'feature/bbb');
  await page.waitForTimeout(2500);

  const continueBtn = page.getByRole('button', { name: 'Continue Claude in new tab' });
  const toastShown = await page
    .locator('[role="status"]')
    .first()
    .waitFor({ state: 'visible', timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  const offersContinue = await continueBtn
    .first()
    .isVisible()
    .catch(() => false);
  log('');
  log('Created-worktree toast shown:', toastShown, '| offers Continue:', offersContinue);
  findings.push(['a created-worktree toast surfaced', toastShown]);
  findings.push(['toast offers "Continue Claude in new tab"', offersContinue]);

  // ─── Click 1: resume into the first worktree (parks origin) ────────────────
  await page.getByRole('button', { name: 'Continue Claude in new tab' }).first().click();
  await page.waitForTimeout(3500); // spawn fork + SIGSTOP-park origin

  tabs = await tabTitles(page);
  log('');
  log('After 1st "Continue Claude":', JSON.stringify(tabs));
  findings.push(['first resume opened a fork tab (now 2 tabs)', tabs.length === 2]);

  // The parked overlay should now name the first worktree.
  const overlay1 = await parkedOverlayText(page);
  log('  parked overlay:', JSON.stringify(overlay1));
  const parkedA = ['wt-a', 'wt-b'].find((b) => overlay1.includes(`Keep working in ${b}`));
  findings.push(['origin pane parked with a "Session paused" overlay', !!parkedA]);
  log('  → handed off to:', parkedA ?? '<none>');

  // ─── Click 2: resume into the SECOND worktree → must be REFUSED ────────────
  const before = (await tabTitles(page)).length;
  await page.getByRole('button', { name: 'Continue Claude in new tab' }).first().click();
  await page.waitForTimeout(2500);

  const errText = await page
    .locator('.text-treeline-red')
    .first()
    .innerText()
    .then((t) => t.replace(/\s+/g, ' ').trim())
    .catch(() => '');
  const after = (await tabTitles(page)).length;
  const overlay2 = await parkedOverlayText(page);

  log('');
  log('After 2nd "Continue Claude":');
  log('  toast error :', JSON.stringify(errText));
  log('  tab count   :', `${before} -> ${after}`);
  log('  parked overlay still:', JSON.stringify(overlay2));

  findings.push([
    'second resume refused with an "already continuing" error',
    /already continuing/i.test(errText),
  ]);
  findings.push(['no second fork tab was created (tab count unchanged)', after === before]);
  findings.push([
    'origin handoff intact — overlay still names the first worktree',
    !!parkedA && overlay2.includes(`Keep working in ${parkedA}`),
  ]);

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
