// Autonomous end-to-end harness for the vault-reader feature: [[wikilink]]
// click-through, relative-md-link interception, the frontmatter properties
// block, folder search scoping, and the Settings vault-path field. Launches
// the built app via Playwright's Electron driver against a seeded fixture
// vault (a git repo of markdown notes) and reads the DOM to decide PASS/FAIL —
// no human in the loop. Negative controls included: a dead wikilink, a
// gitignored target, and a wikilink inside a code fence.
//
// Run:  npm run build && node tests/e2e/vault-reader-harness.mjs
// Needs:  out/main/index.js (npm run build) + the host-arch @vscode/ripgrep dep.

import { _electron as electron } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MAIN = join(ROOT, 'out', 'main', 'index.js');
const log = (...a) => console.log(...a);

const git = (cwd, ...args) =>
  execFileSync('git', args, {
    cwd,
    stdio: 'pipe',
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
  });

function buildVault(codeRoot) {
  const vault = join(codeRoot, 'vault');
  mkdirSync(join(vault, 'Sub'), { recursive: true });
  git(vault, 'init', '--quiet', '--initial-branch', 'main');
  git(vault, 'config', 'user.name', 'Test User');
  git(vault, 'config', 'user.email', 'test@example.com');
  git(vault, 'config', 'commit.gpgsign', 'false');

  writeFileSync(
    join(vault, 'index-note.md'),
    [
      '---',
      'type: policy',
      'tags: [alpha, beta]',
      '---',
      '',
      '# Index note',
      '',
      'Go to [[alpha-note]] for details.',
      'This one is dead: [[missing-note]].',
      'This one is gitignored: [[hidden-task]].',
      '',
      'A relative link: [beta](Sub/beta-note.md).',
      'An external link: [anthropic](https://www.anthropic.com/).',
      '',
      '```',
      'code fence stays literal: [[alpha-note]]',
      '```',
      '',
    ].join('\n'),
  );
  writeFileSync(join(vault, 'alpha-note.md'), '# Alpha\n\nALPHA-BODY-TOKEN\n');
  writeFileSync(join(vault, 'Sub', 'beta-note.md'), '# Beta\n\nBETA-BODY-TOKEN\n');
  writeFileSync(join(vault, '.gitignore'), 'Tasks/\n');
  mkdirSync(join(vault, 'Tasks'), { recursive: true });
  writeFileSync(join(vault, 'Tasks', 'hidden-task.md'), '# Hidden\n');
  git(vault, 'add', '-A');
  git(vault, 'commit', '--quiet', '--no-gpg-sign', '-m', 'init');
  return realpathSync(vault);
}

/** A plain, non-git folder with one uniquely-named file, for ⌘P scoping. */
function buildPlainFolder(codeRoot) {
  const folder = join(codeRoot, 'plainnotes');
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'zz-plain-only.md'), '# Plain\n');
  return realpathSync(folder);
}

const sendMenu = (app, channel) =>
  app.evaluate(({ BrowserWindow }, ch) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.webContents.send(ch);
  }, channel);

async function openViaQuickOpen(page, app, query) {
  await sendMenu(app, 'search:quickOpen');
  await page.waitForSelector('[role="dialog"][aria-label="Go to file"]', { timeout: 10000 });
  await page.getByRole('textbox', { name: 'Go to file' }).fill(query);
  await page.waitForSelector('[data-ss="quick-open-item"]', { timeout: 10000 });
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    () => !document.querySelector('[role="dialog"][aria-label="Go to file"]'),
    { timeout: 5000 },
  );
}

async function main() {
  const codeRoot = mkdtempSync(join(tmpdir(), 'treeline-vault-code-'));
  const vault = buildVault(codeRoot);
  const plain = buildPlainFolder(codeRoot);
  const userDataDir = mkdtempSync(join(tmpdir(), 'treeline-vault-data-'));
  const configPath = join(userDataDir, 'config.json');
  writeFileSync(
    configPath,
    JSON.stringify({
      schemaVersion: 4,
      repos: [{ path: vault, name: 'vault', addedAt: Date.now() }],
      folders: [{ path: plain, name: 'plainnotes', addedAt: Date.now() }],
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
    // Select the vault worktree (sets the search root) by opening a terminal in it.
    await page.waitForSelector('[data-ss="worktree-row"]', { timeout: 15000 });
    await page.locator(`[data-ss-path="${vault}"] button[title="${vault}"]`).first().click();
    await page.waitForSelector('.xterm-rows', { timeout: 15000 });

    // ── Open the index note via ⌘P (also proves vault-scoped quick-open) ──
    await openViaQuickOpen(page, app, 'index-note');
    await page.waitForSelector('[data-ss="wikilink"]', { timeout: 10000 });
    results.openedPreview = true;

    // ── Frontmatter properties block ──
    const fm = await page.evaluate(
      () => document.querySelector('[data-ss="frontmatter"]')?.innerText ?? null,
    );
    results.frontmatterBlock = fm !== null && fm.includes('type') && fm.includes('alpha');
    // Negative: the literal '---' fence must not be rendered in the body.
    const body = await page.evaluate(() => document.body.innerText);
    results.noLiteralFence = !/^---$/m.test(fm ?? '');

    // ── Dead + gitignored wikilinks render as dim spans (wait for index) ──
    await page.waitForFunction(
      () => document.querySelectorAll('[data-ss="wikilink-missing"]').length >= 2,
      { timeout: 10000 },
    );
    const missing = await page.evaluate(() =>
      [...document.querySelectorAll('[data-ss="wikilink-missing"]')].map((el) => el.innerText),
    );
    results.deadLinkDim = missing.some((t) => t.includes('missing-note'));
    results.gitignoredUnresolved = missing.some((t) => t.includes('hidden-task'));

    // ── Code fence stays literal (not an anchor) ──
    const fenceLiteral = await page.evaluate(() => {
      const pre = [...document.querySelectorAll('pre')].find((el) =>
        el.textContent.includes('[[alpha-note]]'),
      );
      return !!pre && pre.querySelector('a') === null;
    });
    results.codeFenceLiteral = fenceLiteral;

    // ── External link keeps target=_blank (negative: not intercepted) ──
    results.externalUntouched = await page.evaluate(() => {
      const a = [...document.querySelectorAll('a')].find((el) =>
        (el.getAttribute('href') ?? '').startsWith('https://www.anthropic.com'),
      );
      return !!a && a.target === '_blank' && a.dataset.ss === undefined;
    });

    // ── Click the wikilink → alpha note opens in the same panel ──
    await page.locator('[data-ss="wikilink"]', { hasText: 'alpha-note' }).first().click();
    await page.waitForFunction(
      () => document.body.innerText.includes('ALPHA-BODY-TOKEN'),
      { timeout: 10000 },
    );
    results.wikilinkNavigated = true;

    // ── Back to the index note; click the relative link → beta note ──
    await openViaQuickOpen(page, app, 'index-note');
    await page.waitForSelector('[data-ss="relative-link"]', { timeout: 10000 });
    await page.locator('[data-ss="relative-link"]').first().click();
    await page.waitForFunction(
      () => document.body.innerText.includes('BETA-BODY-TOKEN'),
      { timeout: 10000 },
    );
    results.relativeNavigated = true;

    // ── Folder search scoping: select the plain folder, ⌘P lists only it ──
    await page.locator(`[data-ss-folder="${plain}"] button[title="${plain}"]`).first().click();
    await sendMenu(app, 'search:quickOpen');
    await page.waitForSelector('[role="dialog"][aria-label="Go to file"]', { timeout: 10000 });
    await page.getByRole('textbox', { name: 'Go to file' }).fill('');
    await page.waitForSelector('[data-ss="quick-open-item"]', { timeout: 10000 });
    const folderItems = await page.evaluate(() =>
      [...document.querySelectorAll('[data-ss="quick-open-item"]')].map((el) => el.innerText),
    );
    results.folderScoped =
      folderItems.some((t) => t.includes('zz-plain-only')) &&
      !folderItems.some((t) => t.includes('index-note'));
    await page.keyboard.press('Escape');

    // ── Settings: vault-path field persists to config.json ──
    await sendMenu(app, 'settings:open');
    const vaultInput = page.getByPlaceholder('/absolute/path/to/your/notes');
    await vaultInput.waitFor({ timeout: 10000 });
    await vaultInput.fill(vault);
    await page.getByRole('button', { name: 'Save' }).click();
    await page.waitForFunction(
      () => !document.querySelector('[data-ss="frontmatter"], [role="dialog"]')?.closest('[role="dialog"]'),
      { timeout: 5000 },
    ).catch(() => {});
    await page.waitForTimeout(500); // atomic write settle
    const savedCfg = JSON.parse(readFileSync(configPath, 'utf8'));
    results.vaultPathPersisted = savedCfg.settings?.vaultPath === vault;
  } catch (err) {
    results.error = err instanceof Error ? err.message : String(err);
  }

  const checks = [
    ['index note opened in preview via vault-scoped ⌘P', results.openedPreview],
    ['frontmatter rendered as a properties block', results.frontmatterBlock],
    ['no literal --- fence in the properties block', results.noLiteralFence],
    ['dead wikilink renders dim (negative control)', results.deadLinkDim],
    ['gitignored target unresolved (negative control)', results.gitignoredUnresolved],
    ['wikilink inside code fence stays literal (negative control)', results.codeFenceLiteral],
    ['external https link untouched (negative control)', results.externalUntouched],
    ['clicking a wikilink opened the target note in-panel', results.wikilinkNavigated],
    ['clicking a relative md link opened the target note in-panel', results.relativeNavigated],
    ['⌘P scopes to a selected plain folder', results.folderScoped],
    ['Settings vault path persists to config.json', results.vaultPathPersisted],
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
