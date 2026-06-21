// Autonomous end-to-end harness for the "restart with multiple scratch
// terminals open" scenario (full process restart + cold-start session restore,
// since v0.17.0 / 45037d8).
//
// Unlike reattach (a renderer reload where main keeps the PTYs), this drives a
// FULL quit + relaunch against the SAME userDataDir, so it exercises the
// disk-backed session.json save + the RestorePrompt cold-start path.
//
// It opens N scratch terminals, lets the debounced (750ms) save land, asserts
// session.json captured them, fully quits, relaunches, restores, and then
// reports what actually came back — including the known gap that the scratch
// SIDEBAR rows are NOT persisted (the scratch slice is memory-only), so the
// restored "Scratch N" terminals return as plain tabs with no sidebar row.
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

const scratchRowLabels = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-ss="scratch-row"]')].map((el) => el.innerText.replace(/\s+/g, ' ').trim()),
  );

async function main() {
  const userDataDir = mkdtempSync(join(tmpdir(), 'treeline-restart-'));
  const sessionPath = join(userDataDir, 'session.json');
  const findings = [];

  // ─── PHASE 1: open N scratch terminals, let the save land, quit ───────────
  let app = await launch(userDataDir);
  let page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');

  const scratchBtn = page.getByTitle('Open a scratch terminal in your home directory');
  for (let i = 0; i < N_SCRATCH; i++) {
    await scratchBtn.click();
    // Each click spawns a fresh PTY + a "Scratch N" tab.
    await page.waitForTimeout(800);
  }
  await page.waitForSelector('.xterm-rows', { state: 'attached', timeout: 15000 });

  const preTabs = await tabTitles(page);
  const preScratch = await scratchRowLabels(page);
  log('PHASE 1 — before restart');
  log('  tabs        :', JSON.stringify(preTabs));
  log('  scratch rows :', JSON.stringify(preScratch));

  // Wait out the debounced (750ms) session.json save, then read it from disk.
  await page.waitForTimeout(1500);
  let saved = null;
  if (existsSync(sessionPath)) saved = JSON.parse(readFileSync(sessionPath, 'utf8'));
  const savedTabCount = saved?.tabs?.length ?? 0;
  const savedTitles = (saved?.tabs ?? []).map((t) => t.title);
  log('  session.json :', existsSync(sessionPath) ? `${savedTabCount} tabs ${JSON.stringify(savedTitles)}` : '<not written>');

  findings.push(['scratch terminals opened', preTabs.length === N_SCRATCH]);
  findings.push(['scratch sidebar rows shown pre-restart', preScratch.length === N_SCRATCH]);
  findings.push([`session.json persisted all ${N_SCRATCH} scratch tabs`, savedTabCount === N_SCRATCH]);

  // Full quit — main dies, every PTY dies with it. Nothing survives but disk.
  await app.close();
  log('  → full quit (all PTYs killed)');

  // ─── PHASE 2: relaunch SAME userDataDir, expect the RestorePrompt ─────────
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
  log('  RestorePrompt shown:', promptShown);
  findings.push(['RestorePrompt offered on cold start', promptShown]);

  if (promptShown) {
    const promptText = await dialog.innerText();
    const saysCount = promptText.includes(`${N_SCRATCH} tabs`);
    log('  prompt text  :', JSON.stringify(promptText.replace(/\s+/g, ' ').trim()));
    findings.push([`prompt counts ${N_SCRATCH} tabs`, saysCount]);

    // Tabs/scratch rows should be empty until the user clicks Restore.
    log('  tabs (pre-restore) :', JSON.stringify(await tabTitles(page)));

    await page.getByRole('button', { name: 'Restore' }).click();
    await page.waitForSelector('.xterm-rows', { state: 'attached', timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2500); // respawn N shells + xterm replay

    const postTabs = await tabTitles(page);
    const postScratch = await scratchRowLabels(page);
    log('  tabs (restored)    :', JSON.stringify(postTabs));
    log('  scratch rows       :', JSON.stringify(postScratch));

    findings.push([`restored all ${N_SCRATCH} scratch tabs`, postTabs.length === N_SCRATCH]);
    // The documented gap: scratch slice is memory-only, so the sidebar rows do
    // NOT come back even though the tabs do.
    const rowsGone = postScratch.length === 0;
    findings.push(['scratch SIDEBAR rows absent after restore (known gap)', rowsGone]);

    // What number would the NEXT scratch get? Open one and see — a reset counter
    // collides with a restored "Scratch 1".
    const beforeOpen = await tabTitles(page);
    await page.getByTitle('Open a scratch terminal in your home directory').click();
    await page.waitForTimeout(900);
    const afterOpen = await tabTitles(page);
    const newLabel = afterOpen.find((t) => !beforeOpen.includes(t)) ?? afterOpen.at(-1);
    log('  next scratch label :', JSON.stringify(newLabel));
    const collides = postTabs.includes(newLabel);
    findings.push([`new scratch label collides with a restored tab (${newLabel})`, collides]);
  }

  await app.close();

  // ─── Report ───────────────────────────────────────────────────────────────
  log('');
  log('════════════════ FINDINGS ════════════════');
  for (const [label, ok] of findings) log(`  ${ok ? '✅' : '❌'}  ${label}`);
  const coreOk =
    findings.find((f) => f[0].startsWith('session.json'))?.[1] &&
    findings.find((f) => f[0].startsWith('RestorePrompt'))?.[1] &&
    findings.find((f) => f[0].startsWith('restored all'))?.[1];
  log('═══════════════════════════════════════════');
  log('CORE RESTORE (tabs survive a full restart):', coreOk ? 'PASS ✅' : 'FAIL ❌');
  process.exit(coreOk ? 0 : 1);
}

main().catch((err) => {
  console.error('HARNESS ERROR:', err);
  process.exit(2);
});
