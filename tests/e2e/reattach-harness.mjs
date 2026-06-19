// Autonomous end-to-end harness for the "re-attach PTYs on reload" feature.
//
// Launches the built app via Playwright's Electron driver, opens a scratch
// terminal, runs a tiny TUI that redraws a marker on SIGWINCH, then performs a
// renderer reload (the programmatic equivalent of ⌘R: the renderer restarts
// while the main process keeps its PTYs). It then reads the xterm DOM and the
// renderer console to decide PASS/FAIL — so the reattach behaviour can be
// verified in a loop with no human driving the GUI.
//
// Run:  node tests/e2e/reattach-harness.mjs
// Needs:  npm run build   (uses out/main/index.js)

import { _electron as electron } from 'playwright';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MAIN = join(ROOT, 'out', 'main', 'index.js');

// A minimal full-screen TUI: enters the alternate screen (like an agent CLI),
// draws a marker, and REDRAWS it on every SIGWINCH. After a reload the new
// xterm is blank; the marker only reappears if our resize-nudge actually makes
// the process repaint — which is exactly what we're testing.
const MARKER = join(tmpdir(), 'treeline-tui-marker.mjs');
writeFileSync(
  MARKER,
  [
    'let n = 0;',
    "process.stdout.write('\\x1b[?1049h');", // enter alt screen
    'const draw = () => { n++; process.stdout.write("\\x1b[2J\\x1b[H" + "REATTACH_MARKER_" + n); };',
    'draw();',
    "process.on('SIGWINCH', draw);",
    'setInterval(() => {}, 1 << 30);',
  ].join('\n'),
);

const xtermText = (page) =>
  page.evaluate(() => {
    const el = document.querySelector('.xterm-rows');
    return el ? el.innerText : '<no .xterm-rows>';
  });

const log = (...a) => console.log(...a);

// Resolve once the terminal text has stopped changing for `quietMs` — i.e. the
// shell prompt has finished drawing and it's safe to type.
async function waitForStableText(page, quietMs = 700, timeoutMs = 10000) {
  const start = Date.now();
  let last = '';
  let lastChange = Date.now();
  while (Date.now() - start < timeoutMs) {
    const t = await xtermText(page);
    if (t !== last) {
      last = t;
      lastChange = Date.now();
    } else if (Date.now() - lastChange >= quietMs && t.trim().length > 0) {
      return;
    }
    await page.waitForTimeout(100);
  }
}

async function main() {
  const userDataDir = mkdtempSync(join(tmpdir(), 'treeline-e2e-'));
  const app = await electron.launch({
    args: [MAIN, '--no-sandbox', '--disable-gpu', `--user-data-dir=${userDataDir}`],
  });

  const consoleLines = [];
  const page = await app.firstWindow();
  page.on('console', (m) => consoleLines.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => consoleLines.push(`[pageerror] ${e.message}`));

  // 1. Open a scratch terminal (no repo config needed).
  await page.getByTitle('Open a scratch terminal in your home directory').click();
  await page.waitForSelector('.xterm-rows', { timeout: 15000 });

  // Wait for the shell prompt to settle — typing while the prompt is still
  // being drawn interleaves keystrokes and garbles the command.
  await waitForStableText(page);

  // 2. Run the TUI marker (or `claude`, if HARNESS_CMD is set) in it.
  const cmd = process.env.HARNESS_CMD ?? `${process.execPath} ${MARKER}`;
  await page.locator('.xterm-screen, .xterm').first().click();
  // insertText sends the command atomically (per-char typing races the prompt
  // echo and can interleave / drop chars), then Enter runs it.
  await page.keyboard.insertText(cmd);
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
  if (process.env.HARNESS_CMD) {
    // Arbitrary TUI (e.g. claude): give it time to start/load and draw.
    await page.waitForTimeout(8000);
  } else {
    await page
      .waitForFunction(
        () =>
          (document.querySelector('.xterm-rows')?.innerText ?? '').includes('REATTACH_MARKER'),
        { timeout: 15000 },
      )
      .catch(() => {});
  }
  const before = (await xtermText(page)).trim();

  // 3. Reload the renderer — the ⌘R equivalent. Main keeps the PTY alive.
  consoleLines.length = 0; // only care about post-reload console
  await page.reload();
  await page.waitForSelector('.xterm-rows', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2000); // let reattach + the resize-nudge land
  const after = (await xtermText(page)).trim();

  // 4. Verdict. Marker mode asserts the exact marker repainted; an arbitrary
  // command (e.g. `claude`) asserts the terminal came back non-blank and shares
  // real content with its pre-reload frame (i.e. the TUI repainted).
  const dimErr = consoleLines.some((l) => l.includes('dimensions'));
  let pass;
  if (process.env.HARNESS_CMD) {
    const norm = (s) => s.replace(/\s+/g, ' ').trim();
    const a = norm(after);
    const b = norm(before);
    // longest pre-reload word ≥6 chars that reappears after reload
    const shared = b
      .split(' ')
      .some((w) => w.length >= 6 && a.includes(w));
    pass = a.length > 15 && shared && !dimErr;
    log('shared content before↔after:', shared);
  } else {
    pass = after.includes('REATTACH_MARKER') && !dimErr;
  }

  log('────────────────────────────────────────');
  log('BEFORE reload :', JSON.stringify(before.slice(0, 60)));
  log('AFTER  reload :', JSON.stringify(after.slice(0, 60)));
  log('terminal repainted after reload:', after.trim().length > 0);
  log('dimensions error in console  :', dimErr);
  log('RESULT:', pass ? 'PASS ✅' : 'FAIL ❌');
  log('──── relevant post-reload console ────');
  for (const l of consoleLines.filter((l) => /xterm|dimensions|DIAG|pageerror|error/i.test(l))) {
    log('  ' + l);
  }

  await app.close();
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error('HARNESS ERROR:', err);
  process.exit(2);
});
