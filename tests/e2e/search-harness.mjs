// Autonomous end-to-end harness for scoped search (⌘P quick-open + ⌘⇧F
// find-in-files). Launches the built app via Playwright's Electron driver,
// seeds a git repo with known files, opens a terminal in it (which selects the
// worktree → sets the search root), then drives BOTH search surfaces and reads
// the DOM to decide PASS/FAIL — no human in the loop.
//
// The ⌘P/⌘⇧F triggers are Electron *menu* accelerators (main → IPC → renderer),
// which Playwright's page.keyboard can't fire — so we send the exact same
// channel the menu's click handler sends (`webContents.send(...)`), faithfully
// simulating the menu action while exercising the full renderer wiring:
// client.ts subscription → panel/modal render → ripgrep search → result click →
// file opens in the code panel at the matched line.
//
// Run:  npm run build && node tests/e2e/search-harness.mjs
// Needs:  out/main/index.js (npm run build) + the host-arch @vscode/ripgrep dep.

import { _electron as electron } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MAIN = join(ROOT, 'out', 'main', 'index.js');
const log = (...a) => console.log(...a);

const git = (cwd, ...args) =>
  execFileSync('git', args, {
    cwd,
    stdio: 'pipe',
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
  });

// A token that occurs in exactly one file, so a content search is unambiguous.
const TOKEN = 'ZZUNIQUESEARCHTOKEN';
const HIT_FILE = 'src/widget.ts';

function buildRepo(codeRoot) {
  const repo = join(codeRoot, 'proj');
  mkdirSync(join(repo, 'src'), { recursive: true });
  git(repo, 'init', '--quiet', '--initial-branch', 'main');
  git(repo, 'config', 'user.name', 'Test User');
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'config', 'commit.gpgsign', 'false');
  // The one file that contains TOKEN — on a known line (line 2).
  writeFileSync(join(repo, HIT_FILE), `export const a = 1;\nconst x = "${TOKEN}";\n`);
  writeFileSync(join(repo, 'src', 'other.ts'), 'export const b = 2;\n');
  writeFileSync(join(repo, 'README.md'), '# proj\n');
  // A gitignored file that ALSO contains the token — must NOT appear in results.
  writeFileSync(join(repo, '.gitignore'), 'ignored/\n');
  mkdirSync(join(repo, 'ignored'), { recursive: true });
  writeFileSync(join(repo, 'ignored', 'secret.ts'), `const s = "${TOKEN}";\n`);
  git(repo, 'add', '-A');
  git(repo, 'commit', '--quiet', '--no-gpg-sign', '-m', 'init');
  return realpathSync(repo);
}

// Faithfully simulate a View-menu click: main sends the channel to the renderer.
const sendMenu = (app, channel) =>
  app.evaluate(({ BrowserWindow }, ch) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.webContents.send(ch);
  }, channel);

const codePanelText = (page) =>
  page.evaluate(() => document.querySelector('.cm-content')?.textContent ?? '');

async function main() {
  const codeRoot = mkdtempSync(join(tmpdir(), 'treeline-search-code-'));
  const repo = buildRepo(codeRoot);
  const userDataDir = mkdtempSync(join(tmpdir(), 'treeline-search-data-'));
  writeFileSync(
    join(userDataDir, 'config.json'),
    JSON.stringify({
      schemaVersion: 4,
      repos: [{ path: repo, name: 'proj', addedAt: Date.now() }],
      folders: [],
    }),
  );

  const app = await electron.launch({
    args: [MAIN, '--no-sandbox', '--disable-gpu', `--user-data-dir=${userDataDir}`],
  });
  const page = await app.firstWindow();
  const consoleLines = [];
  page.on('console', (m) => consoleLines.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => consoleLines.push(`[pageerror] ${e.message}`));

  const results = {};
  try {
    // Open a terminal in the repo's main worktree — openTabAt sets
    // selectedSidebarPath = the worktree, which is the search root.
    await page.waitForSelector('[data-ss="worktree-row"]', { timeout: 15000 });
    await page.locator(`[data-ss-path="${repo}"] button[title="${repo}"]`).first().click();
    await page.waitForSelector('.xterm-rows', { timeout: 15000 });

    // ── ⌘⇧F find-in-files ───────────────────────────────────────────────────
    await sendMenu(app, 'search:findInFiles');
    await page.waitForSelector('[data-ss="search-panel"]', { timeout: 10000 });
    results.panelOpened = true;
    await page.getByLabel('Search query').fill(TOKEN);

    // Results are debounced (250ms) + async rg; wait for a match row.
    await page
      .waitForSelector('[data-ss="search-match"]', { timeout: 10000 })
      .catch(async () => {
        const summary = await page.evaluate(
          () => document.querySelector('[data-ss="search-panel"]')?.innerText ?? '<no panel>',
        );
        log('  DIAG search-panel text:', JSON.stringify(summary));
        throw new Error('no search-match appeared');
      });
    const files = await page.evaluate(() =>
      [...document.querySelectorAll('[data-ss="search-file"]')].map((el) => el.dataset.ssFile),
    );
    results.panelOpened = true;
    results.foundHitFile = files.includes(HIT_FILE);
    // Negative control: the gitignored copy of TOKEN must be excluded.
    results.excludedIgnored = !files.some((f) => f.includes('ignored/'));

    // Click the match → file opens in the code panel at the matched line.
    await page.locator('[data-ss="search-match"]').first().click();
    await page.waitForSelector('.cm-content', { timeout: 10000 });
    await page.waitForFunction(
      (tok) => (document.querySelector('.cm-content')?.textContent ?? '').includes(tok),
      TOKEN,
      { timeout: 10000 },
    );
    results.openedFromSearch = (await codePanelText(page)).includes(TOKEN);

    // ── ⌘P quick-open ───────────────────────────────────────────────────────
    await sendMenu(app, 'search:quickOpen');
    await page.waitForSelector('[role="dialog"][aria-label="Go to file"]', { timeout: 10000 });
    await page.getByRole('textbox', { name: 'Go to file' }).fill('widget');
    await page.waitForSelector('[data-ss="quick-open-item"]', { timeout: 10000 });
    const items = await page.evaluate(() =>
      [...document.querySelectorAll('[data-ss="quick-open-item"]')].map((el) => el.innerText),
    );
    results.quickOpenListed = items.some((t) => t.includes('widget'));
    await page.keyboard.press('Enter');
    await page.waitForFunction(
      () => !document.querySelector('[role="dialog"][aria-label="Go to file"]'),
      { timeout: 5000 },
    );
    await page.waitForFunction(
      () => (document.querySelector('.cm-content')?.textContent ?? '').includes('export const a'),
      { timeout: 10000 },
    );
    results.openedFromQuickOpen = (await codePanelText(page)).includes('export const a');
  } catch (err) {
    results.error = err instanceof Error ? err.message : String(err);
  }

  const checks = [
    ['find-in-files panel opened', results.panelOpened],
    ['content search found the hit file', results.foundHitFile],
    ['gitignored copy excluded (negative control)', results.excludedIgnored],
    ['clicking a hit opened the file in the code panel', results.openedFromSearch],
    ['quick-open listed the file by fuzzy name', results.quickOpenListed],
    ['quick-open Enter opened the file', results.openedFromQuickOpen],
  ];
  const pass = checks.every(([, ok]) => ok === true);

  log('────────────────────────────────────────');
  for (const [name, ok] of checks) log(`  ${ok ? '✓' : '✗'} ${name}`);
  if (results.error) log('  harness error:', results.error);
  log('RESULT:', pass ? 'PASS ✅' : 'FAIL ❌');
  if (!pass) {
    log('──── console (all) ────');
    for (const l of consoleLines) log('  ' + l);
  }

  await app.close();
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error('HARNESS ERROR:', err);
  process.exit(2);
});
