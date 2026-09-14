// Run after npm run build. Uses disposable repos and an isolated Electron profile.
import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, unlinkSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const fixture = mkdtempSync(join(tmpdir(), 'treeline-maintenance-'));
const repo = join(fixture, 'repo');
const profile = join(fixture, 'profile');
mkdirSync(repo);
mkdirSync(profile);
const git = (...args) => execFileSync('git', args, {
  cwd: repo,
  encoding: 'utf8',
  env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
});
git('init', '-q', '-b', 'main');
git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-qm', 'Initial');
const broken = join(repo, 'broken');
const healthy = join(repo, 'healthy-detached');
git('worktree', 'add', '-b', 'broken', broken);
git('worktree', 'add', '--detach', healthy);
writeFileSync(join(broken, 'notes.txt'), 'Keep this uncommitted work');
unlinkSync(join(broken, '.git'));
writeFileSync(join(profile, 'config.json'), JSON.stringify({
  schemaVersion: 4,
  repos: [{ path: repo, name: 'maintenance-fixture', addedAt: Date.now() }],
}));

const app = await electron.launch({
  args: [join(process.cwd(), 'out/main/index.js'), '--no-sandbox', '--disable-gpu'],
  env: { ...process.env, TREELINE_USER_DATA: profile, TREELINE_SOCK: join(profile, 'cli.sock') },
});
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(15_000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('button', { name: /^Library/ }).click();
  const repoNode = page.locator('[data-ss="repo-node"]').first();
  await repoNode.getByRole('button', { name: 'maintenance-fixture' }).click();
  await page.getByRole('button', { name: 'Worktree needs attention' }).waitFor();
  await repoNode.hover();
  await page.getByRole('button', { name: 'Refresh and repair worktrees' }).click();
  const dialog = page.getByRole('dialog', { name: 'Worktree maintenance' });
  await dialog.getByRole('button', { name: 'Prune stale entries…' }).waitFor();
  await dialog.getByText('Checking worktrees…').waitFor({ state: 'hidden' });
  assert.match(await dialog.innerText(), /\(detached\)/);
  await page.screenshot({ path: join(fixture, 'maintenance-before.png') });
  await dialog.getByRole('button', { name: 'Repair links', exact: true }).click();
  await dialog.getByText('No stale registrations to prune.').waitFor();
  await dialog.getByText('Checking worktrees…').waitFor({ state: 'hidden' });
  assert.equal(existsSync(join(broken, '.git')), true);
  assert.equal(readFileSync(join(broken, 'notes.txt'), 'utf8'), 'Keep this uncommitted work');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Worktree needs attention' }).count(), 0);

  // A leftover directory can be explicitly pruned, keeping its contents.
  unlinkSync(join(broken, '.git'));
  await page.getByRole('button', { name: 'Worktree needs attention' }).click();
  await dialog.getByRole('button', { name: 'Prune stale entries…' }).click();
  await dialog.getByRole('button', { name: 'Confirm prune' }).click();
  await dialog.getByText('No stale registrations to prune.').waitFor();
  await dialog.getByText('Checking worktrees…').waitFor({ state: 'hidden' });
  assert.equal(readFileSync(join(broken, 'notes.txt'), 'utf8'), 'Keep this uncommitted work');
  assert.equal(existsSync(join(healthy, '.git')), true);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  assert.equal(await page.locator('[data-ss="worktree-row"]').count(), 2);

  // External deletion reaches the renderer via the watcher's snapshot, no reload.
  git('worktree', 'remove', healthy);
  await page.waitForFunction(() => document.querySelectorAll('[data-ss="worktree-row"]').length === 1);
  assert.deepEqual(errors, []);
  console.log(`PASS: repair, prune, detached preservation, and automatic deletion refresh. Screenshot: ${join(fixture, 'maintenance-before.png')}`);
} finally {
  await app.close();
  // Retain the screenshot for visual review; all app data and repositories are disposable.
  rmSync(repo, { recursive: true, force: true });
  rmSync(profile, { recursive: true, force: true });
}
