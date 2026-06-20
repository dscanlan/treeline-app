// End-to-end regression test for "restart with multiple scratch terminals open"
// (full process restart + cold-start session restore).
//
// Unlike reattach-harness.mjs (a renderer reload where main keeps the PTYs),
// this drives a FULL quit + relaunch against the SAME userDataDir, so it
// exercises the disk-backed session.json save + the RestorePrompt cold-start
// path. It asserts the scratch round-trip is whole after restore:
//   • the sidebar scratch rows come back (the scratch slice is re-seeded from
//     the persisted `scratch` tab flag — it is otherwise memory-only),
//   • numbering stays dense (a new scratch is `Scratch N+1`, not a colliding
//     `Scratch 1`),
//   • exit-cleanup is rewired (exiting a restored scratch removes its row).
//
// Run:  npm run build && node tests/e2e/restart-scratch-harness.mjs

import { _electron as electron } from 'playwright';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MAIN = join(ROOT, 'out', 'main', 'index.js');
const N_SCRATCH = 3;
const log = (...a) => console.log(...a);

const launch = (userDataDir) =>
  electron.launch({
    args: [MAIN, '--no-sandbox', '--disable-gpu', `--user-data-dir=${userDataDir}`],
  });

const tabTitles = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('[role="tab"]')].map((el) => el.innerText.replace(/\s+/g, ' ').trim()),
  );

// Row innerText is like ">_ Scratch 1 ×"; strip the prompt glyph + close button
// to recover the bare label.
const scratchRowLabels = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-ss="scratch-row"]')].map((el) =>
      el.innerText.replace(/\s+/g, ' ').replace(/^>_\s*/, '').replace(/\s*×$/, '').trim(),
    ),
  );

const leavesOf = (node) => (node.kind === 'leaf' ? [node] : node.children.flatMap(leavesOf));

async function main() {
  const userDataDir = mkdtempSync(join(tmpdir(), 'treeline-restart-'));
  const sessionPath = join(userDataDir, 'session.json');
  const findings = [];
  const check = (label, ok) => findings.push([label, !!ok]);

  // ─── PHASE 1: open N scratch terminals, let the save land, quit ───────────
  let app = await launch(userDataDir);
  let page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');

  const scratchBtn = page.getByTitle('Open a scratch terminal in your home directory');
  for (let i = 0; i < N_SCRATCH; i++) {
    await scratchBtn.click();
    await page.waitForTimeout(800);
  }
  await page.waitForSelector('.xterm-rows', { state: 'attached', timeout: 15000 });

  const preTabs = await tabTitles(page);
  const preScratch = await scratchRowLabels(page);
  log('PHASE 1 — before restart');
  log('  tabs         :', JSON.stringify(preTabs));
  log('  scratch rows :', JSON.stringify(preScratch));

  // Wait out the debounced (750ms) session.json save, then read it from disk.
  await page.waitForTimeout(1500);
  const saved = existsSync(sessionPath) ? JSON.parse(readFileSync(sessionPath, 'utf8')) : null;
  const savedTabs = saved?.tabs ?? [];
  const flaggedScratch = savedTabs.filter((t) => t.scratch === true).length;
  log('  session.json :', `${savedTabs.length} tabs, ${flaggedScratch} flagged scratch`);

  check('N scratch terminals opened', preTabs.length === N_SCRATCH);
  check('N scratch sidebar rows shown pre-restart', preScratch.length === N_SCRATCH);
  check('session.json persisted N scratch tabs', savedTabs.length === N_SCRATCH);
  check('every persisted scratch tab carries scratch:true', flaggedScratch === N_SCRATCH);
  // The flag rides single-leaf tabs only.
  check(
    'each scratch tab is a single leaf',
    savedTabs.every((t) => leavesOf(t.root).length === 1),
  );

  await app.close();
  log('  → full quit (all PTYs killed)');

  // ─── PHASE 2: relaunch SAME userDataDir, restore, assert the round-trip ───
  app = await launch(userDataDir);
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');

  const dialog = page.getByRole('dialog', { name: 'Restore previous session' });
  const promptShown = await dialog
    .waitFor({ state: 'visible', timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  log('');
  log('PHASE 2 — after restart');
  check('RestorePrompt offered on cold start', promptShown);

  if (promptShown) {
    check('prompt counts N tabs', (await dialog.innerText()).includes(`${N_SCRATCH} tabs`));

    await page.getByRole('button', { name: 'Restore' }).click();
    await page.waitForSelector('.xterm-rows', { state: 'attached', timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2500); // respawn N shells + xterm replay

    const postTabs = await tabTitles(page);
    const postScratch = await scratchRowLabels(page);
    log('  tabs (restored)    :', JSON.stringify(postTabs));
    log('  scratch rows       :', JSON.stringify(postScratch));

    check('restored all N scratch tabs', postTabs.length === N_SCRATCH);
    // THE FIX: the scratch slice is re-seeded, so the sidebar rows come back.
    check('scratch sidebar rows restored', postScratch.length === N_SCRATCH);
    check(
      'restored rows keep their original labels',
      ['Scratch 1', 'Scratch 2', 'Scratch 3'].every((l) => postScratch.includes(l)),
    );

    // Numbering stays dense: nextScratchNumber sees the restored labels, so the
    // next scratch is Scratch 4 — not a colliding Scratch 1.
    const before = await tabTitles(page);
    // Fresh locator — the phase-1 scratchBtn is bound to the now-closed window.
    await page.getByTitle('Open a scratch terminal in your home directory').click();
    await page.waitForTimeout(1000);
    const after = await tabTitles(page);
    const newLabel = (after.find((t) => !before.includes(t)) ?? '').replace(/\s*×$/, '').trim();
    log('  next scratch label :', JSON.stringify(newLabel));
    check(`new scratch is Scratch ${N_SCRATCH + 1} (no collision)`, newLabel === `Scratch ${N_SCRATCH + 1}`);

    // Exit-cleanup is rewired: type `exit` in a restored scratch and its row
    // (and tab) disappear, proving registerScratchCleanup ran on restore.
    const rowsBeforeExit = (await scratchRowLabels(page)).length;
    await page.locator('[role="tab"]').first().click();
    await page.waitForTimeout(300);
    await page.locator('.xterm-screen:visible').first().click();
    await page.keyboard.insertText('exit');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1500);
    const rowsAfterExit = (await scratchRowLabels(page)).length;
    log('  scratch rows: before exit', rowsBeforeExit, '→ after exit', rowsAfterExit);
    check('exiting a restored scratch removes its row', rowsAfterExit === rowsBeforeExit - 1);
  }

  await app.close();

  // ─── Report ───────────────────────────────────────────────────────────────
  log('');
  log('════════════════ FINDINGS ════════════════');
  for (const [label, ok] of findings) log(`  ${ok ? '✅' : '❌'}  ${label}`);
  const pass = findings.every((f) => f[1]);
  log('═══════════════════════════════════════════');
  log('RESULT:', pass ? 'PASS ✅' : 'FAIL ❌');
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error('HARNESS ERROR:', err);
  process.exit(2);
});
