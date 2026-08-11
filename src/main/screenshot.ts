import { app, BrowserWindow, ipcMain } from 'electron';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Channels } from '@shared/ipc-channels';
import { makeLeaf, makeNodeId } from '@shared/pane-tree';
import type { PaneLeaf, PaneNode } from '@shared/pane-tree';
import type { ScreenshotHydratePayload } from '@shared/ipc-contract';
import type {
  ChangedFile,
  DetectedProcess,
  DirEntry,
  FileDiff,
  Folder,
  PrInfo,
  Repo,
  Scratch,
  SettingsConfig,
  Tab,
  Worktree,
} from '@shared/types';
import {
  DEFAULT_TERMINAL_FONT_FAMILY,
  DEFAULT_TERMINAL_FONT_SIZE,
  DEFAULT_TERMINAL_THEME_ID,
} from '@shared/terminal-theme';
import type { PtyManager } from './pty-manager';

/**
 * Headless capture harness. Activated by setting `TREELINE_SCREENSHOT_ID=<id>`
 * before launching electron. Main loads the renderer, waits for it to signal
 * that `loadInitialState()` is done, runs the matching scenario's setup,
 * waits for the next paint, calls `webContents.capturePage()`, writes a PNG
 * to docs/img/, and exits.
 *
 * `webContents.capturePage()` returns the renderer bitmap only — no native
 * title bar, no traffic lights, no shadow. That's a deliberate trade-off:
 * full automation in exchange for losing macOS chrome. The interactive
 * `scripts/take-screenshots.sh` flow remains for chrome-critical shots.
 *
 * Terminal-content scenarios (03/07/11/14) spawn real PTYs into mkdtemp
 * directories with a clean PS1 so the captured prompt is predictable.
 */

// ── Fixture repos ───────────────────────────────────────────────────────────

const REPO_TREELINE_APP: Repo = {
  path: '/Users/example/code/treeline-app',
  name: 'treeline-app',
  addedAt: 1_700_000_000_000,
};
const WORKTREES_TREELINE_APP: Worktree[] = [
  {
    path: '/Users/example/code/treeline-app',
    branch: 'main',
    commit: 'a1b2c3d',
    isBare: false,
    isDirty: false,
    isCurrent: false,
    isClaude: false,
    merged: false,
  },
  {
    path: '/Users/example/code/treeline-app/feat-auth',
    branch: 'feat-auth',
    commit: 'b7c8d9e',
    isBare: false,
    isDirty: false,
    isCurrent: false,
    isClaude: false,
    merged: false,
  },
  {
    path: '/Users/example/code/treeline-app/.claude/worktrees/discovery-feat',
    branch: 'worktree-discovery-feat',
    commit: 'd4e5f6a',
    isBare: false,
    isDirty: true,
    isCurrent: false,
    isClaude: true,
    merged: false,
  },
];

const REPO_CGS: Repo = {
  path: '/Users/example/code/cgs',
  name: 'cgs',
  addedAt: 1_715_000_000_000,
};
const WORKTREES_CGS: Worktree[] = [
  {
    path: '/Users/example/code/cgs',
    branch: 'main',
    commit: '693b890',
    isBare: false,
    isDirty: false,
    isCurrent: false,
    isClaude: false,
    merged: false,
  },
  {
    path: '/Users/example/code/cgs/.claude/worktrees/tender-conjuring-lamport',
    branch: 'worktree-tender-conjuring-lamport',
    commit: '89a557e',
    isBare: false,
    isDirty: false,
    isCurrent: false,
    isClaude: true,
    merged: false,
  },
  {
    path: '/Users/example/code/cgs/.claude/worktrees/serene-curious-knuth',
    branch: 'worktree-serene-curious-knuth',
    commit: 'c2d3e4f',
    isBare: false,
    isDirty: false,
    isCurrent: false,
    isClaude: true,
    merged: false,
  },
];

const REPO_DASHBOARD: Repo = {
  path: '/Users/example/code/dashboard',
  name: 'dashboard',
  addedAt: 1_710_000_000_000,
};
const WORKTREES_DASHBOARD: Worktree[] = [
  {
    path: '/Users/example/code/dashboard',
    branch: 'main',
    commit: 'e5f6a7b',
    isBare: false,
    isDirty: false,
    isCurrent: false,
    isClaude: false,
    merged: false,
  },
  {
    path: '/Users/example/code/dashboard/auth-worktree',
    branch: 'feat-auth-redesign',
    commit: 'f1a2b3c',
    isBare: false,
    isDirty: false,
    isCurrent: false,
    isClaude: false,
    merged: false,
  },
  {
    path: '/Users/example/code/dashboard/bug-fix-worktree',
    branch: 'fix-pagination-overflow',
    commit: '234567a',
    isBare: false,
    isDirty: true,
    isCurrent: false,
    isClaude: false,
    merged: false,
  },
];

const ALL_WORKTREES = {
  [REPO_TREELINE_APP.path]: WORKTREES_TREELINE_APP,
  [REPO_CGS.path]: WORKTREES_CGS,
  [REPO_DASHBOARD.path]: WORKTREES_DASHBOARD,
};

const SCALE_REPO_NAMES = [
  'accounts-api',
  'audit-service',
  'auth-gateway',
  'billing-worker',
  'catalog-api',
  'checkout-web',
  'customer-data',
  'design-system',
  'developer-portal',
  'event-router',
  'feature-flags',
  'fulfilment-api',
  'identity-service',
  'inventory-worker',
  'mobile-app',
  'notifications-api',
  'observability',
  'orders-service',
  'payments-api',
  'pricing-engine',
  'reporting-web',
  'risk-service',
  'search-api',
  'shipping-worker',
  'support-tools',
  'tax-service',
  'treeline-app',
  'web-storefront',
  'workflow-engine',
  'workspace-tools',
];

function buildScaleFixtures(): {
  repos: Repo[];
  worktreesByRepo: Record<string, Worktree[]>;
} {
  const repos: Repo[] = [];
  const worktreesByRepo: Record<string, Worktree[]> = {};
  for (const [index, name] of SCALE_REPO_NAMES.entries()) {
    const area = index < 10 ? 'platform' : index < 20 ? 'products' : 'labs';
    const path = `/Users/example/work/${area}/${name}`;
    const repo: Repo = { path, name, addedAt: 1_700_000_000_000 + index };
    const worktrees: Worktree[] = [
      {
        path,
        branch: 'main',
        commit: `${index.toString(16).padStart(2, '0')}a12bc`,
        isBare: false,
        isDirty: index === 8 || index === 22,
        isCurrent: false,
        isClaude: false,
        merged: false,
      },
      {
        path: `${path}-worktrees/feature-${index + 1}`,
        branch: `feat/initiative-${index + 1}`,
        commit: `${index.toString(16).padStart(2, '0')}d45ef`,
        isBare: false,
        isDirty: index === 3 || index === 27,
        isCurrent: false,
        isClaude: false,
        merged: index === 12,
      },
    ];
    if (index % 6 === 0) {
      worktrees.push({
        path: `${path}/.claude/worktrees/agent-${index + 1}`,
        branch: `worktree-agent-${index + 1}`,
        commit: `${index.toString(16).padStart(2, '0')}f67ab`,
        isBare: false,
        isDirty: false,
        isCurrent: false,
        isClaude: true,
        merged: false,
      });
    }
    repos.push(repo);
    worktreesByRepo[path] = worktrees;
  }
  return { repos, worktreesByRepo };
}

/** Build a SettingsConfig from factory defaults plus per-scenario overrides. */
function settingsCfg(overrides: Partial<SettingsConfig> = {}): SettingsConfig {
  return {
    terminalTheme: DEFAULT_TERMINAL_THEME_ID,
    fontFamily: DEFAULT_TERMINAL_FONT_FAMILY,
    fontSize: DEFAULT_TERMINAL_FONT_SIZE,
    keybindings: {},
    vaultPath: null,
    ...overrides,
  };
}

// Saved-on-disk content for the edit-mode scenarios, and the in-progress draft
// (one extra line) so the unsaved-changes dot + Save button show.
const LOGIN_TS = `import { db } from '../db';
import { verifyPassword } from './password';
import { AuthError } from './errors';

export async function login(email: string, password: string) {
  const user = await db.users.findByEmail(email);
  if (!user) {
    throw new AuthError('no account for that email');
  }
  return verifyPassword(user, password);
}
`;
const LOGIN_TS_DRAFT = LOGIN_TS.replace(
  '  const user = await db.users.findByEmail(email);\n',
  '  const user = await db.users.findByEmail(email);\n  await rateLimiter.check(email);\n',
);

// ── Scenario plumbing ──────────────────────────────────────────────────────

interface ScenarioCtx {
  win: BrowserWindow;
  ptyManager: PtyManager | null;
  /** Resources to clean up after capture (PTY ids + temp dirs). */
  cleanups: Array<() => Promise<void>>;
}

type Scenario = (ctx: ScenarioCtx) => Promise<void>;

const SCENARIOS: Record<string, Scenario> = {
  // ── basic states ───────────────────────────────────────────────────────

  '01-empty': async ({ win }) => {
    sendHydrate(win, { reset: true });
  },

  '02-sidebar': async ({ win }) => {
    sendHydrate(win, {
      reset: true,
      repos: [REPO_DASHBOARD, REPO_TREELINE_APP, REPO_CGS],
      worktreesByRepo: ALL_WORKTREES,
    });
  },

  '42-sidebar-scale': async ({ win }) => {
    const { repos, worktreesByRepo } = buildScaleFixtures();
    const activePaths = [
      worktreesByRepo[repos[1]!.path]![0]!.path,
      worktreesByRepo[repos[3]!.path]![1]!.path,
      worktreesByRepo[repos[8]!.path]![0]!.path,
      worktreesByRepo[repos[12]!.path]![1]!.path,
      worktreesByRepo[repos[22]!.path]![0]!.path,
      worktreesByRepo[repos[27]!.path]![1]!.path,
    ];
    const processesByWorktreePath = Object.fromEntries(
      activePaths.map((path, index) => [
        path,
        [{ pid: 41_000 + index, kind: 'claude' as const, cwd: path, idle: index % 2 === 0 }],
      ]),
    );
    sendHydrate(win, {
      reset: true,
      repos,
      worktreesByRepo,
      processesByWorktreePath,
      sidebarMode: 'working',
      sidebarPins: [worktreesByRepo[repos[26]!.path]![0]!.path],
      selected: activePaths[1],
    });
  },

  '43-pinned-files': async ({ win }) => {
    const wt = WORKTREES_TREELINE_APP[1]!;
    const selectedFile = `${wt.path}/src/auth/login.ts`;
    const otherReadme = `${REPO_CGS.path}/README.md`;
    const missingReadme = '/Users/example/archive/README.md';
    sendHydrate(win, {
      reset: true,
      repos: [REPO_TREELINE_APP, REPO_CGS],
      worktreesByRepo: {
        [REPO_TREELINE_APP.path]: WORKTREES_TREELINE_APP,
        [REPO_CGS.path]: WORKTREES_CGS,
      },
      selected: wt.path,
      sidebarFileRoot: wt.path,
      expandedDirs: { [wt.path]: true, [`${wt.path}/src`]: true },
      dirChildren: {
        [wt.path]: [
          { name: 'src', path: `${wt.path}/src`, type: 'dir' },
          { name: 'README.md', path: `${wt.path}/README.md`, type: 'file' },
        ],
        [`${wt.path}/src`]: [
          { name: 'auth', path: `${wt.path}/src/auth`, type: 'dir' },
          { name: 'index.ts', path: `${wt.path}/src/index.ts`, type: 'file' },
        ],
      },
      pinnedFilePaths: [missingReadme, selectedFile, otherReadme],
      missingPinnedFiles: [missingReadme],
      codePanelOpen: true,
      codePanelWidth: 520,
      openFilePath: selectedFile,
      panelMode: 'file',
      openFileText: LOGIN_TS,
    });
  },

  '32-listening-ports': async ({ win }) => {
    // Listening-port chips: a dim cyan `:PORT` per TCP port a process rooted in
    // the worktree is listening on. feat-auth runs a dev server across two
    // ports; the Claude worktree shows a chip sitting beside its magenta
    // process badge, demonstrating the shared metadata line.
    const devWt = WORKTREES_TREELINE_APP[1]!; // feat-auth
    const claudeWt = WORKTREES_TREELINE_APP[2]!; // discovery-feat (Claude path)
    const fakeClaude: DetectedProcess = {
      pid: 31415,
      kind: 'claude',
      cwd: claudeWt.path,
      idle: false,
    };
    sendHydrate(win, {
      reset: true,
      repos: [REPO_TREELINE_APP],
      worktreesByRepo: { [REPO_TREELINE_APP.path]: WORKTREES_TREELINE_APP },
      processesByWorktreePath: { [claudeWt.path]: [fakeClaude] },
      portsByWorktreePath: {
        [devWt.path]: [3000, 5173],
        [claudeWt.path]: [8787],
      },
    });
  },

  '34-pr-status': async ({ win }) => {
    // Linked-PR badges: `#NNN` colored by state plus a CI rollup glyph, on the
    // same metadata line as the port chips / process badge. feat-auth has an
    // open PR with passing checks (green #482 ✓); the Claude worktree has a
    // draft PR with checks still running (dim #471 ●), shown beside its magenta
    // process badge and dirty dot to demonstrate the shared metadata line.
    const featWt = WORKTREES_TREELINE_APP[1]!; // feat-auth
    const claudeWt = WORKTREES_TREELINE_APP[2]!; // worktree-discovery-feat
    const fakeClaude: DetectedProcess = {
      pid: 31415,
      kind: 'claude',
      cwd: claudeWt.path,
      idle: false,
    };
    const prByBranch: Record<string, PrInfo> = {
      [featWt.branch]: {
        number: 482,
        state: 'open',
        url: 'https://github.com/example/treeline-app/pull/482',
        checks: 'passing',
      },
      [claudeWt.branch]: {
        number: 471,
        state: 'draft',
        url: 'https://github.com/example/treeline-app/pull/471',
        checks: 'pending',
      },
    };
    sendHydrate(win, {
      reset: true,
      repos: [REPO_TREELINE_APP],
      worktreesByRepo: { [REPO_TREELINE_APP.path]: WORKTREES_TREELINE_APP },
      processesByWorktreePath: { [claudeWt.path]: [fakeClaude] },
      prByRepoBranch: { [REPO_TREELINE_APP.path]: prByBranch },
    });
  },

  '04-create-modal': async ({ win }) => {
    sendHydrate(win, {
      reset: true,
      repos: [REPO_TREELINE_APP],
      worktreesByRepo: { [REPO_TREELINE_APP.path]: WORKTREES_TREELINE_APP },
      modal: { kind: 'create-worktree', repoPath: REPO_TREELINE_APP.path },
    });
  },

  '05-delete-modal': async ({ win }) => {
    const target = WORKTREES_TREELINE_APP[2]!; // the dirty Claude worktree
    sendHydrate(win, {
      reset: true,
      repos: [REPO_TREELINE_APP],
      worktreesByRepo: { [REPO_TREELINE_APP.path]: WORKTREES_TREELINE_APP },
      modal: {
        kind: 'delete-worktree',
        repoPath: REPO_TREELINE_APP.path,
        worktreePath: target.path,
        branch: target.branch,
      },
    });
  },

  // The point of ⌘B: with a tab open, hiding the sidebar hands the whole
  // window width to the terminal. Spawns a real PTY so the captured pane
  // shows an actual shell rather than the empty state (which is what
  // 44-sidebar-hidden-empty covers instead).
  '06-collapsed': async (ctx) => {
    const { tab, ptyId } = await spawnTabPty(ctx, 'main');
    await waitForPtySettle(ctx, ptyId);
    sendHydrate(ctx.win, {
      reset: true,
      repos: [REPO_DASHBOARD, REPO_TREELINE_APP, REPO_CGS],
      worktreesByRepo: ALL_WORKTREES,
      tabs: [tab],
      activeTabId: tab.id,
      sidebarCollapsed: true,
    });
    await delay(400);
    await typeAndSettle(ctx, ptyId, [
      'clear\n',
      "echo 'treeline-app on main · sidebar hidden (⌘B)'\n",
      'git --version\n',
    ]);
  },

  // The escape hatch: sidebar collapsed *and* no terminals open, so the
  // window would otherwise be blank. TerminalHost swaps the empty-state copy
  // for a sidebar-aware message plus a real "Show sidebar (⌘B)" button.
  '44-sidebar-hidden-empty': async ({ win }) => {
    sendHydrate(win, {
      reset: true,
      repos: [REPO_DASHBOARD, REPO_TREELINE_APP, REPO_CGS],
      worktreesByRepo: ALL_WORKTREES,
      sidebarCollapsed: true,
    });
  },

  '08-filter': async ({ win }) => {
    sendHydrate(win, {
      reset: true,
      repos: [REPO_DASHBOARD, REPO_TREELINE_APP, REPO_CGS],
      worktreesByRepo: ALL_WORKTREES,
      filter: 'auth',
    });
  },

  '12-claude-group-expanded': async ({ win }) => {
    sendHydrate(win, {
      reset: true,
      repos: [REPO_CGS],
      worktreesByRepo: { [REPO_CGS.path]: WORKTREES_CGS },
    });
  },

  '13-dirty-marker': async ({ win }) => {
    sendHydrate(win, {
      reset: true,
      repos: [REPO_DASHBOARD],
      worktreesByRepo: { [REPO_DASHBOARD.path]: WORKTREES_DASHBOARD },
    });
  },

  // ── auto-discovery flow ────────────────────────────────────────────────

  '16-discovery-toast': async ({ win }) => {
    sendHydrate(win, {
      reset: true,
      repos: [REPO_TREELINE_APP],
      worktreesByRepo: { [REPO_TREELINE_APP.path]: WORKTREES_TREELINE_APP },
      pendingDiscoveries: [
        {
          repoPath: REPO_CGS.path,
          viaCwd: '/Users/example/code/cgs/.claude/worktrees/tender-conjuring-lamport',
        },
      ],
    });
  },

  '17-add-after-discovery': async ({ win }) => {
    sendHydrate(win, {
      reset: true,
      repos: [REPO_CGS, REPO_TREELINE_APP],
      worktreesByRepo: {
        [REPO_CGS.path]: WORKTREES_CGS,
        [REPO_TREELINE_APP.path]: WORKTREES_TREELINE_APP,
      },
      selected: REPO_CGS.path,
    });
  },

  '35-worktree-open-toast': async ({ win }) => {
    // A new worktree was just created (e.g. an agent ran `git worktree add`);
    // treeline offers to open a terminal in it rather than carrying on as if
    // the work were still happening in the original worktree.
    sendHydrate(win, {
      reset: true,
      repos: [REPO_TREELINE_APP],
      worktreesByRepo: { [REPO_TREELINE_APP.path]: WORKTREES_TREELINE_APP },
      driftByWorktree: {
        [WORKTREES_TREELINE_APP[1]!.path]: {
          toWorktree: WORKTREES_TREELINE_APP[1]!.path,
          reason: 'created',
        },
      },
    });
  },

  // ── hover-state captures ───────────────────────────────────────────────

  '09-hover-repo-actions': async ({ win }) => {
    sendHydrate(win, {
      reset: true,
      repos: [REPO_TREELINE_APP],
      worktreesByRepo: { [REPO_TREELINE_APP.path]: WORKTREES_TREELINE_APP },
    });
    await delay(150);
    await hoverElement(win, '[data-ss="repo-node"]');
  },

  '10-hover-worktree-delete': async ({ win }) => {
    sendHydrate(win, {
      reset: true,
      repos: [REPO_TREELINE_APP],
      worktreesByRepo: { [REPO_TREELINE_APP.path]: WORKTREES_TREELINE_APP },
    });
    await delay(150);
    await hoverElement(
      win,
      '[data-ss="worktree-row"][data-ss-path$="discovery-feat"]',
    );
  },

  '15-sidebar-collapse-btn': async ({ win }) => {
    sendHydrate(win, {
      reset: true,
      repos: [REPO_TREELINE_APP],
      worktreesByRepo: { [REPO_TREELINE_APP.path]: WORKTREES_TREELINE_APP },
    });
    await delay(150);
    await hoverElement(win, '[data-ss="sidebar-toggle"]');
  },

  // ── terminal-content captures ──────────────────────────────────────────
  // Spawn real PTYs in mkdtemp dirs with PS1='> ' so the prompt is clean
  // and predictable. The PTY's xterm subscribes via the ptyId we feed into
  // the tabs hydrate, so subsequent `pty.write` calls render in the canvas.

  '03-terminal': async (ctx) => {
    const { tab, ptyId } = await spawnTabPty(ctx, 'main');
    // Wait for the shell to finish sourcing rc files. Without this the
    // typed commands get echoed but never executed — the queued input
    // sits in the PTY buffer until init completes.
    await waitForPtySettle(ctx, ptyId);
    sendHydrate(ctx.win, {
      reset: true,
      repos: [REPO_TREELINE_APP],
      worktreesByRepo: { [REPO_TREELINE_APP.path]: WORKTREES_TREELINE_APP },
      tabs: [tab],
      activeTabId: tab.id,
      selected: REPO_TREELINE_APP.path,
    });
    // Let xterm mount and subscribe to PTY data before we write commands.
    await delay(400);
    await typeAndSettle(ctx, ptyId, [
      "clear\n",
      "echo 'treeline-app on main · ready'\n",
      "git --version\n",
      "ls -la 2>/dev/null | head -6\n",
    ]);
  },

  '07-multi-tabs': async (ctx) => {
    const a = await spawnTabPty(ctx, 'main');
    const b = await spawnTabPty(ctx, 'feat-auth');
    await Promise.all([
      waitForPtySettle(ctx, a.ptyId),
      waitForPtySettle(ctx, b.ptyId),
    ]);
    sendHydrate(ctx.win, {
      reset: true,
      repos: [REPO_TREELINE_APP],
      worktreesByRepo: { [REPO_TREELINE_APP.path]: WORKTREES_TREELINE_APP },
      tabs: [a.tab, b.tab],
      activeTabId: b.tab.id,
      selected: REPO_TREELINE_APP.path,
      terminalStatus: [
        { ptyId: a.ptyId, status: 'idle', foregroundCmd: null },
        { ptyId: b.ptyId, status: 'running', foregroundCmd: 'npm test' },
      ],
    });
    await delay(400);
    await typeAndSettle(ctx, a.ptyId, ["clear\n", "echo 'main · idle prompt'\n"]);
    await typeAndSettle(ctx, b.ptyId, [
      "clear\n",
      "echo 'treeline-app on feat-auth'\n",
      "echo 'npm test  (4 of 32 suites)'\n",
    ]);
  },

  '11-claude-tab-running': async (ctx) => {
    const wt = WORKTREES_TREELINE_APP[2]!; // discovery-feat (Claude path)
    const { tab, ptyId } = await spawnTabPty(ctx, 'discovery-feat');
    await waitForPtySettle(ctx, ptyId);
    const fakeClaude: DetectedProcess = {
      pid: 31415,
      kind: 'claude',
      cwd: wt.path,
      idle: false,
    };
    sendHydrate(ctx.win, {
      reset: true,
      repos: [REPO_TREELINE_APP],
      worktreesByRepo: { [REPO_TREELINE_APP.path]: WORKTREES_TREELINE_APP },
      tabs: [tab],
      activeTabId: tab.id,
      selected: wt.path,
      processesByWorktreePath: { [wt.path]: [fakeClaude] },
      terminalStatus: [
        { ptyId: ptyId, status: 'running', foregroundCmd: 'claude' },
      ],
    });
    await delay(400);
    await typeAndSettle(ctx, ptyId, [
      "clear\n",
      "printf '\\033[35m\\xe2\\x9c\\xa6 Claude Code session\\033[0m\\n'\n",
      "printf 'Worktree: discovery-feat\\n'\n",
      "printf 'Status: running \\xc2\\xb7 awaiting input\\n'\n",
    ]);
  },

  '36-agent-notifications': async (ctx) => {
    // A Claude agent in a background-capable pane has raised an attention
    // notification (OSC 9/99/777, or its Claude Code Stop/Notification hook).
    // The pane gets a magenta ring + text badge, the tab turns into a pulsing
    // magenta "waiting" tab, and the worktree row gets an unread dot.
    const wt = WORKTREES_TREELINE_APP[2]!; // discovery-feat (Claude path)
    const spawned = await spawnTabPty(ctx, 'discovery-feat');
    const ptyId = spawned.ptyId;
    // Pin the tab's cwd to the fixture worktree path (spawnTabPty runs the real
    // PTY in a temp dir) so the sidebar's cwd-keyed unread badge resolves to the
    // discovery-feat worktree row. xterm still subscribes by ptyId, so the pane
    // shows live content regardless.
    const tab: Tab = { ...spawned.tab, cwd: wt.path };
    await waitForPtySettle(ctx, ptyId);
    const fakeClaude: DetectedProcess = {
      pid: 31415,
      kind: 'claude',
      cwd: wt.path,
      idle: true,
    };
    sendHydrate(ctx.win, {
      reset: true,
      repos: [REPO_TREELINE_APP],
      worktreesByRepo: { [REPO_TREELINE_APP.path]: WORKTREES_TREELINE_APP },
      tabs: [tab],
      activeTabId: tab.id,
      selected: wt.path,
      processesByWorktreePath: { [wt.path]: [fakeClaude] },
      terminalStatus: [{ ptyId, status: 'idle', foregroundCmd: null }],
      unreadByPtyId: { [ptyId]: { text: 'Claude needs your input', at: Date.now() } },
    });
    await delay(400);
    await typeAndSettle(ctx, ptyId, [
      "clear\n",
      "printf '\\033[35m\\xe2\\x9c\\xa6 Claude Code session\\033[0m\\n'\n",
      "printf 'Counted to 10. What would you like me to do next?\\n'\n",
    ]);
  },

  '37-session-paused': async (ctx) => {
    // The user resumed this pane's Claude conversation in a worktree, so the
    // origin session is SIGSTOP-parked and shown the "Session paused" overlay
    // with a way back. The frozen terminal shows faintly behind the dim so it's
    // clear a real session is parked, not gone.
    const wt = WORKTREES_TREELINE_APP[1]!; // feat-auth — the worktree it moved to
    const spawned = await spawnTabPty(ctx, 'main');
    const ptyId = spawned.ptyId;
    // Pin the tab cwd to the repo root (the origin session lives in main).
    const tab: Tab = { ...spawned.tab, cwd: REPO_TREELINE_APP.path };
    await waitForPtySettle(ctx, ptyId);
    sendHydrate(ctx.win, {
      reset: true,
      repos: [REPO_TREELINE_APP],
      worktreesByRepo: { [REPO_TREELINE_APP.path]: WORKTREES_TREELINE_APP },
      tabs: [tab],
      activeTabId: tab.id,
      selected: REPO_TREELINE_APP.path,
      handoffByOriginPty: {
        [ptyId]: {
          originPtyId: ptyId,
          originTabId: tab.id,
          originCwd: REPO_TREELINE_APP.path,
          worktreeCwd: wt.path,
          forkTabId: 'fork-tab',
        },
      },
    });
    await delay(400);
    await typeAndSettle(ctx, ptyId, [
      "clear\n",
      "printf '\\033[35m\\xe2\\x9c\\xa6 Claude Code session\\033[0m\\n'\n",
      "printf 'Implemented the auth module; created worktree feat-auth.\\n'\n",
    ]);
    // Let the dim overlay settle over the terminal before capture.
    await delay(300);
  },

  '38-reattach-toast': async (ctx) => {
    // After a reload — the app restarting on its own, or the laptop rebooting
    // and the app relaunching — treeline re-adopts the PTYs that survived in
    // the main process and shows a transient "Restored N terminals" toast.
    // Here two terminals (incl. a Claude session) have just been re-attached.
    const a = await spawnTabPty(ctx, 'main');
    const b = await spawnTabPty(ctx, 'feat-auth');
    await Promise.all([
      waitForPtySettle(ctx, a.ptyId),
      waitForPtySettle(ctx, b.ptyId),
    ]);
    sendHydrate(ctx.win, {
      reset: true,
      repos: [REPO_TREELINE_APP],
      worktreesByRepo: { [REPO_TREELINE_APP.path]: WORKTREES_TREELINE_APP },
      tabs: [a.tab, b.tab],
      activeTabId: a.tab.id,
      selected: REPO_TREELINE_APP.path,
      terminalStatus: [
        { ptyId: a.ptyId, status: 'running', foregroundCmd: 'claude' },
        { ptyId: b.ptyId, status: 'idle', foregroundCmd: null },
      ],
    });
    await delay(400);
    await typeAndSettle(ctx, a.ptyId, [
      "clear\n",
      "printf '\\033[35m\\xe2\\x9c\\xa6 Claude Code session restored\\033[0m\\n'\n",
      "printf 'Picking up where we left off after the reload.\\n'\n",
    ]);
    await typeAndSettle(ctx, b.ptyId, [
      "clear\n",
      "echo 'feat-auth · npm test (4 of 32 suites)'\n",
    ]);
    // Pop the auto-dismissing toast last so it's still on screen at capture.
    sendHydrate(ctx.win, { reattachNotice: { count: 2, at: Date.now() } });
    await delay(500);
  },

  '39-restore-prompt': async (ctx) => {
    // A *full* restart — an auto-update relaunch (quitAndInstall) or a reboot —
    // kills the background process, so no PTYs survive to re-adopt. Instead the
    // saved tab layout (session.json) drives a "Restore previous session?"
    // prompt on the next cold launch; confirming respawns the tabs and resumes
    // any Claude panes. The window behind is a fresh launch (populated sidebar,
    // no open tabs yet) with the prompt staged over it.
    const main = WORKTREES_TREELINE_APP[0]!;
    const featWt = WORKTREES_TREELINE_APP[1]!; // feat-auth
    sendHydrate(ctx.win, {
      reset: true,
      repos: [REPO_TREELINE_APP],
      worktreesByRepo: { [REPO_TREELINE_APP.path]: WORKTREES_TREELINE_APP },
      selected: REPO_TREELINE_APP.path,
      pendingRestore: {
        version: 1,
        tabs: [
          {
            id: 'restore-main',
            cwd: main.path,
            title: 'treeline-app',
            focusedPaneId: 'restore-main-pane',
            root: {
              kind: 'leaf',
              id: 'restore-main-pane',
              cwd: main.path,
              title: 'treeline-app',
              agentKind: 'claude',
            },
          },
          {
            id: 'restore-feat',
            cwd: featWt.path,
            title: 'feat-auth',
            focusedPaneId: 'restore-feat-pane',
            root: {
              kind: 'leaf',
              id: 'restore-feat-pane',
              cwd: featWt.path,
              title: 'feat-auth',
            },
          },
        ],
        activeTabId: 'restore-feat',
      },
    });
    await delay(400);
  },

  // The post-restore state for scratch terminals: after a full restart, the
  // memory-only scratch slice is re-seeded from the persisted `scratch` tab
  // flag, so the `>_ Scratch` rows return to the sidebar (with dense numbering)
  // alongside their respawned tabs.
  '40-scratch-restored': async (ctx) => {
    const a = await spawnTabPty(ctx, 'Scratch 1');
    const b = await spawnTabPty(ctx, 'Scratch 2');
    await Promise.all([
      waitForPtySettle(ctx, a.ptyId),
      waitForPtySettle(ctx, b.ptyId),
    ]);
    const scratchA: Scratch = {
      id: a.ptyId,
      label: 'Scratch 1',
      ptyId: a.ptyId,
      cwd: '/Users/example',
      createdAt: 1_730_000_000_000,
    };
    const scratchB: Scratch = {
      id: b.ptyId,
      label: 'Scratch 2',
      ptyId: b.ptyId,
      cwd: '/Users/example',
      createdAt: 1_730_000_001_000,
    };
    sendHydrate(ctx.win, {
      reset: true,
      repos: [REPO_TREELINE_APP],
      worktreesByRepo: { [REPO_TREELINE_APP.path]: WORKTREES_TREELINE_APP },
      scratches: [scratchA, scratchB],
      selectedScratchId: scratchA.id,
      tabs: [a.tab, b.tab],
      activeTabId: a.tab.id,
      terminalStatus: [
        { ptyId: a.ptyId, status: 'idle', foregroundCmd: null },
        { ptyId: b.ptyId, status: 'idle', foregroundCmd: null },
      ],
    });
    await delay(400);
    await typeAndSettle(ctx, a.ptyId, ['clear\n', "echo 'scratch shell — ~ (home)'\n"]);
    await typeAndSettle(ctx, b.ptyId, ['clear\n']);
  },

  '41-worktree-merged': async ({ win }) => {
    // Merged-worktree treatment: a worktree whose branch is already merged into
    // the default branch renders greyed-out with a "merged" badge, so stale
    // prune-candidates are visually distinct at a glance. feat-auth is marked
    // merged; the un-merged Claude worktree below it stays at full opacity, so
    // the shot proves only merged rows are dimmed.
    const worktrees = WORKTREES_TREELINE_APP.map((wt) =>
      wt.branch === 'feat-auth' ? { ...wt, merged: true } : wt,
    );
    sendHydrate(win, {
      reset: true,
      repos: [REPO_TREELINE_APP],
      worktreesByRepo: { [REPO_TREELINE_APP.path]: worktrees },
    });
  },

  '14-status-dots': async (ctx) => {
    const a = await spawnTabPty(ctx, 'main'); // running
    const b = await spawnTabPty(ctx, 'feat-auth'); // idle
    await Promise.all([
      waitForPtySettle(ctx, a.ptyId),
      waitForPtySettle(ctx, b.ptyId),
    ]);
    sendHydrate(ctx.win, {
      reset: true,
      repos: [REPO_TREELINE_APP],
      worktreesByRepo: { [REPO_TREELINE_APP.path]: WORKTREES_TREELINE_APP },
      tabs: [a.tab, b.tab],
      activeTabId: a.tab.id,
      selected: REPO_TREELINE_APP.path,
      terminalStatus: [
        { ptyId: a.ptyId, status: 'running', foregroundCmd: 'npm test' },
        { ptyId: b.ptyId, status: 'idle', foregroundCmd: null },
      ],
    });
    await delay(400);
    await typeAndSettle(ctx, a.ptyId, [
      "clear\n",
      "echo 'npm test' && echo '… 4 of 32 passing'\n",
    ]);
  },

  // ── add-button tooltip (custom in-renderer overlay) ────────────────────

  // ── scratch terminals + create-repo modal ──────────────────────────────
  // Surface the two new sidebar affordances. `19` shows the auto-numbered
  // scratch rows pinned above the repo list with a divider; `20` shows the
  // CreateRepoModal in its default mode so docs can illustrate the new-repo
  // flow without recording a video.

  '19-scratch-terminals': async ({ win }) => {
    const scratchA: Scratch = {
      id: 'scratch-1-id',
      label: 'Scratch 1',
      ptyId: 'scratch-1-id',
      cwd: '/Users/example',
      createdAt: 1_730_000_000_000,
    };
    const scratchB: Scratch = {
      id: 'scratch-2-id',
      label: 'Scratch 2',
      ptyId: 'scratch-2-id',
      cwd: '/Users/example',
      createdAt: 1_730_000_001_000,
    };
    sendHydrate(win, {
      reset: true,
      repos: [REPO_DASHBOARD, REPO_TREELINE_APP, REPO_CGS],
      worktreesByRepo: ALL_WORKTREES,
      scratches: [scratchA, scratchB],
      // Highlight Scratch 1 so the selection styling is visible in the shot.
      selectedScratchId: scratchA.id,
    });
  },

  '20-create-repo-modal': async ({ win }) => {
    sendHydrate(win, {
      reset: true,
      repos: [REPO_TREELINE_APP],
      worktreesByRepo: { [REPO_TREELINE_APP.path]: WORKTREES_TREELINE_APP },
      modal: { kind: 'create-repo' },
    });
  },

  // ── code viewer: Changed list + diff panel ─────────────────────────────
  // Shows the whole feature in one shot: a worktree's folder expanded to the
  // Changed list in the sidebar, and the split code panel rendering a file's
  // diff (working tree vs HEAD) next to a terminal.

  '21-code-viewer-diff': async (ctx) => {
    const wt = WORKTREES_TREELINE_APP[1]!; // feat-auth
    const file = `${wt.path}/src/auth/login.ts`;
    const changed: ChangedFile[] = [
      { path: file, relPath: 'src/auth/login.ts', status: 'modified' },
      { path: `${wt.path}/src/auth/session.ts`, relPath: 'src/auth/session.ts', status: 'added' },
      { path: `${wt.path}/src/auth/tokens.ts`, relPath: 'src/auth/tokens.ts', status: 'modified' },
      { path: `${wt.path}/.env.local`, relPath: '.env.local', status: 'untracked' },
      { path: `${wt.path}/README.md`, relPath: 'README.md', status: 'modified' },
    ];
    const diff: FileDiff = {
      path: file,
      added: 3,
      removed: 1,
      binary: false,
      lines: [
        { kind: 'hunk', oldLine: null, newLine: null, text: 'function login(email, password) {' },
        { kind: 'context', oldLine: 41, newLine: 41, text: '  const user = await db.users.findByEmail(email);' },
        { kind: 'del', oldLine: 42, newLine: null, text: '  if (!user) return null;' },
        { kind: 'add', oldLine: null, newLine: 42, text: '  if (!user) {' },
        { kind: 'add', oldLine: null, newLine: 43, text: "    throw new AuthError('no account for that email');" },
        { kind: 'add', oldLine: null, newLine: 44, text: '  }' },
        { kind: 'context', oldLine: 43, newLine: 45, text: '  return verifyPassword(user, password);' },
        { kind: 'context', oldLine: 44, newLine: 46, text: '}' },
      ],
    };

    const { tab, ptyId } = await spawnTabPty(ctx, 'feat-auth');
    await waitForPtySettle(ctx, ptyId);
    sendHydrate(ctx.win, {
      reset: true,
      repos: [REPO_TREELINE_APP],
      worktreesByRepo: { [REPO_TREELINE_APP.path]: WORKTREES_TREELINE_APP },
      tabs: [tab],
      activeTabId: tab.id,
      selected: wt.path,
      terminalStatus: [{ ptyId: ptyId, status: 'idle', foregroundCmd: null }],
      // Code viewer: expand feat-auth's folder, show its Changed list, and open
      // login.ts as a diff in the panel.
      expandedDirs: { [wt.path]: true },
      sidebarFileRoot: wt.path,
      worktreeFileView: { [wt.path]: 'changed' },
      changedByWorktree: { [wt.path]: changed },
      codePanelOpen: true,
      codePanelWidth: 520,
      openFilePath: file,
      panelMode: 'diff',
      openDiff: diff,
    });
    await delay(400);
    await typeAndSettle(ctx, ptyId, [
      'clear\n',
      "echo 'treeline-app on feat-auth'\n",
    ]);
  },

  // ── code editor: editing a file + the unsaved-changes modal ─────────────

  '22-file-editing': async (ctx) => {
    const wt = WORKTREES_TREELINE_APP[1]!; // feat-auth
    const file = `${wt.path}/src/auth/login.ts`;
    const { tab, ptyId } = await spawnTabPty(ctx, 'feat-auth');
    await waitForPtySettle(ctx, ptyId);
    sendHydrate(ctx.win, {
      reset: true,
      repos: [REPO_TREELINE_APP],
      worktreesByRepo: { [REPO_TREELINE_APP.path]: WORKTREES_TREELINE_APP },
      tabs: [tab],
      activeTabId: tab.id,
      selected: wt.path,
      terminalStatus: [{ ptyId: ptyId, status: 'idle', foregroundCmd: null }],
      expandedDirs: { [wt.path]: true },
      sidebarFileRoot: wt.path,
      worktreeFileView: { [wt.path]: 'changed' },
      changedByWorktree: {
        [wt.path]: [
          { path: file, relPath: 'src/auth/login.ts', status: 'modified' },
          { path: `${wt.path}/.env.local`, relPath: '.env.local', status: 'untracked' },
        ],
      },
      // File view, mid-edit: a draft with one extra line vs the saved text, so
      // the amber unsaved dot and Save button are visible.
      codePanelOpen: true,
      codePanelWidth: 520,
      openFilePath: file,
      panelMode: 'file',
      openFileText: LOGIN_TS,
      editing: true,
      draft: LOGIN_TS_DRAFT,
    });
    await delay(400);
    await typeAndSettle(ctx, ptyId, ['clear\n', "echo 'editing login.ts'\n"]);
  },

  '23-discard-modal': async (ctx) => {
    const wt = WORKTREES_TREELINE_APP[1]!; // feat-auth
    const file = `${wt.path}/src/auth/login.ts`;
    const { tab, ptyId } = await spawnTabPty(ctx, 'feat-auth');
    await waitForPtySettle(ctx, ptyId);
    sendHydrate(ctx.win, {
      reset: true,
      repos: [REPO_TREELINE_APP],
      worktreesByRepo: { [REPO_TREELINE_APP.path]: WORKTREES_TREELINE_APP },
      tabs: [tab],
      activeTabId: tab.id,
      selected: wt.path,
      terminalStatus: [{ ptyId: ptyId, status: 'idle', foregroundCmd: null }],
      expandedDirs: { [wt.path]: true },
      sidebarFileRoot: wt.path,
      worktreeFileView: { [wt.path]: 'changed' },
      changedByWorktree: {
        [wt.path]: [{ path: file, relPath: 'src/auth/login.ts', status: 'modified' }],
      },
      codePanelOpen: true,
      codePanelWidth: 520,
      openFilePath: file,
      panelMode: 'file',
      openFileText: LOGIN_TS,
      editing: true,
      draft: LOGIN_TS_DRAFT,
      // The unsaved-changes confirmation, e.g. triggered by clicking another file.
      modal: { kind: 'confirm-discard', filename: 'login.ts', then: { type: 'stop-editing' } },
    });
    await delay(400);
  },

  // ── code viewer: rendered markdown Preview ──────────────────────────────
  '24-markdown-preview': async (ctx) => {
    const wt = WORKTREES_TREELINE_APP[1]!; // feat-auth
    const file = `${wt.path}/README.md`;
    const md = [
      '# treeline-app',
      '',
      'A keyboard-driven workspace for **git worktrees**, with an embedded',
      'terminal and a side _code panel_. See the [docs](https://example.com).',
      '',
      '## Features',
      '',
      '- Browse worktrees and files',
      '- [x] Diff and File views',
      '- [x] Markdown **Preview**',
      '- [ ] Split panes',
      '',
      '## Status legend',
      '',
      '| Dot | Meaning |',
      '| --- | --- |',
      '| green | idle |',
      '| magenta | running |',
      '| gray | exited |',
      '',
      '## Example',
      '',
      '```ts',
      'function login(email: string, password: string) {',
      '  const user = db.users.findByEmail(email);',
      "  if (!user) throw new AuthError('no account');",
      '  return verifyPassword(user, password);',
      '}',
      '```',
      '',
      '> Tip: press the **Preview** tab to render markdown.',
    ].join('\n');

    const { tab, ptyId } = await spawnTabPty(ctx, 'feat-auth');
    await waitForPtySettle(ctx, ptyId);
    sendHydrate(ctx.win, {
      reset: true,
      repos: [REPO_TREELINE_APP],
      worktreesByRepo: { [REPO_TREELINE_APP.path]: WORKTREES_TREELINE_APP },
      tabs: [tab],
      activeTabId: tab.id,
      selected: wt.path,
      terminalStatus: [{ ptyId: ptyId, status: 'idle', foregroundCmd: null }],
      expandedDirs: { [wt.path]: true },
      sidebarFileRoot: wt.path,
      worktreeFileView: { [wt.path]: 'changed' },
      changedByWorktree: {
        [wt.path]: [{ path: file, relPath: 'README.md', status: 'modified' }],
      },
      // Markdown opens on the rendered Preview; the panel header gains a
      // Preview tab alongside Diff | File.
      codePanelOpen: true,
      codePanelWidth: 560,
      openFilePath: file,
      panelMode: 'preview',
      openFileText: md,
    });
    await delay(400);
    await typeAndSettle(ctx, ptyId, ['clear\n', "echo 'markdown preview'\n"]);
  },

  // ── mermaid: a ```mermaid fence renders as a diagram, not a code block ──
  // Same Preview mode as 24; the fence goes through MermaidBlock instead of
  // rehype-highlight. mermaid is imported lazily on first diagram, so this
  // scenario waits noticeably longer than the others before capturing.

  '45-mermaid-preview': async (ctx) => {
    const wt = WORKTREES_TREELINE_APP[1]!; // feat-auth
    const file = `${wt.path}/ARCHITECTURE.md`;
    const md = [
      '# Architecture',
      '',
      'How a note reaches the screen:',
      '',
      '```mermaid',
      'graph LR',
      '  A[Notes folder] --> B{Preview}',
      '  B -->|mermaid fence| C[MermaidBlock]',
      '  B -->|other fence| D[Code block]',
      '  C --> E((SVG))',
      '```',
      '',
      '## Handshake',
      '',
      '```mermaid',
      'sequenceDiagram',
      '  Renderer->>Main: read note',
      '  Main-->>Renderer: markdown',
      '  Renderer->>Mermaid: render(graph)',
      '  Mermaid-->>Renderer: svg',
      '```',
      '',
      'Ordinary fences are untouched:',
      '',
      '```ts',
      "const diagram = mermaidSource(node);",
      '```',
    ].join('\n');

    const { tab, ptyId } = await spawnTabPty(ctx, 'feat-auth');
    await waitForPtySettle(ctx, ptyId);
    sendHydrate(ctx.win, {
      reset: true,
      repos: [REPO_TREELINE_APP],
      worktreesByRepo: { [REPO_TREELINE_APP.path]: WORKTREES_TREELINE_APP },
      tabs: [tab],
      activeTabId: tab.id,
      selected: wt.path,
      terminalStatus: [{ ptyId: ptyId, status: 'idle', foregroundCmd: null }],
      expandedDirs: { [wt.path]: true },
      sidebarFileRoot: wt.path,
      worktreeFileView: { [wt.path]: 'changed' },
      changedByWorktree: {
        [wt.path]: [{ path: file, relPath: 'ARCHITECTURE.md', status: 'modified' }],
      },
      codePanelOpen: true,
      codePanelWidth: 620,
      openFilePath: file,
      panelMode: 'preview',
      openFileText: md,
    });
    // The lazy mermaid chunk has to load and both diagrams lay out before the
    // capture, which is why this waits far longer than a static scenario.
    await delay(2500);
  },

  // ── split panes: two terminals side-by-side in one tab ──────────────────
  // Splits the focused pane to the right (⌘D): two live PTYs share the tab,
  // each its own xterm with a status dot + badge. The focused (right) pane
  // shows the cyan focus ring.

  '25-split-right': async (ctx) => {
    const a = await spawnLeafPty(ctx, 'main', { status: 'idle' });
    const b = await spawnLeafPty(ctx, 'feat-auth', {
      status: 'running',
      foregroundCmd: 'npm test',
    });
    await Promise.all([
      waitForPtySettle(ctx, a.ptyId),
      waitForPtySettle(ctx, b.ptyId),
    ]);
    const root = split('h', [a.leaf, b.leaf]);
    const now = Date.now();
    const tab: Tab = {
      id: a.ptyId,
      cwd: a.leaf.cwd,
      title: 'main',
      root,
      focusedPaneId: b.leaf.id,
      createdAt: now,
      lastActiveAt: now,
    };
    sendHydrate(ctx.win, {
      reset: true,
      repos: [REPO_TREELINE_APP],
      worktreesByRepo: { [REPO_TREELINE_APP.path]: WORKTREES_TREELINE_APP },
      tabs: [tab],
      activeTabId: tab.id,
      selected: REPO_TREELINE_APP.path,
    });
    await delay(400);
    await typeAndSettle(ctx, a.ptyId, [
      'clear\n',
      "echo 'main · editing'\n",
      'git status -sb 2>/dev/null | head -4\n',
    ]);
    await typeAndSettle(ctx, b.ptyId, [
      'clear\n',
      "echo 'feat-auth · npm test'\n",
      "echo 'PASS  src/auth/login.test.ts (12)'\n",
      "echo 'Tests: 12 passed, running…'\n",
    ]);
  },

  // ── split panes: a three-pane layout (split right, then down) ───────────
  // Left pane full-height; the right column split into two stacked panes
  // (⌘⇧D). Demonstrates the cmux-style nesting and ⌘⌥-arrow directional
  // focus; the bottom-right pane holds the focus ring.

  '26-split-grid': async (ctx) => {
    const a = await spawnLeafPty(ctx, 'main', { status: 'idle' });
    const b = await spawnLeafPty(ctx, 'feat-auth', {
      status: 'running',
      foregroundCmd: 'claude',
    });
    const c = await spawnLeafPty(ctx, 'feat-auth', {
      status: 'running',
      foregroundCmd: 'npm run dev',
    });
    await Promise.all([
      waitForPtySettle(ctx, a.ptyId),
      waitForPtySettle(ctx, b.ptyId),
      waitForPtySettle(ctx, c.ptyId),
    ]);
    const root = split('h', [a.leaf, split('v', [b.leaf, c.leaf])]);
    const now = Date.now();
    const tab: Tab = {
      id: a.ptyId,
      cwd: a.leaf.cwd,
      title: 'main',
      root,
      focusedPaneId: c.leaf.id,
      createdAt: now,
      lastActiveAt: now,
    };
    sendHydrate(ctx.win, {
      reset: true,
      repos: [REPO_TREELINE_APP],
      worktreesByRepo: { [REPO_TREELINE_APP.path]: WORKTREES_TREELINE_APP },
      tabs: [tab],
      activeTabId: tab.id,
      selected: REPO_TREELINE_APP.path,
    });
    await delay(400);
    await typeAndSettle(ctx, a.ptyId, ['clear\n', "echo 'main · shell'\n", 'ls -1 src 2>/dev/null | head -6\n']);
    await typeAndSettle(ctx, b.ptyId, ['clear\n', "echo 'feat-auth · claude'\n", "echo '✦ working on the diff…'\n"]);
    await typeAndSettle(ctx, c.ptyId, [
      'clear\n',
      "echo 'feat-auth · npm run dev'\n",
      "echo '  VITE ready in 312 ms'\n",
      "echo '  ➜  Local: http://localhost:3000/'\n",
    ]);
  },

  // ── embedded browser pane beside a terminal ─────────────────────────────
  // Opens BrowserPane (⌘⇧B) pointed at a local fake dev server so the webview
  // renders a real page — address bar, back/forward/reload, and the running
  // app side-by-side with the terminal.

  '27-browser': async (ctx) => {
    const url = await startFakeServer(ctx);
    const { tab, ptyId } = await spawnTabPty(ctx, 'feat-auth');
    await waitForPtySettle(ctx, ptyId);
    sendHydrate(ctx.win, {
      reset: true,
      repos: [REPO_TREELINE_APP],
      worktreesByRepo: { [REPO_TREELINE_APP.path]: WORKTREES_TREELINE_APP },
      tabs: [tab],
      activeTabId: tab.id,
      selected: REPO_TREELINE_APP.path,
      terminalStatus: [{ ptyId, status: 'running', foregroundCmd: 'npm run dev' }],
      browserPanelOpen: true,
      browserPanelWidth: 640,
      browserSrc: url,
      browserAddress: url,
      browserTitle: 'Acme Dashboard · dev',
    });
    await delay(400);
    await typeAndSettle(ctx, ptyId, [
      'clear\n',
      "echo 'feat-auth · npm run dev'\n",
      "echo '  ➜  Local: http://localhost:3000/'\n",
    ]);
    // The <webview> loads asynchronously; give it time to fetch + paint the
    // page before capturePage() so the shot shows rendered content.
    await delay(1800);
  },

  '18-add-button-tooltip': async ({ win }) => {
    sendHydrate(win, {
      reset: true,
      repos: [REPO_TREELINE_APP],
      worktreesByRepo: { [REPO_TREELINE_APP.path]: WORKTREES_TREELINE_APP },
      forceTooltipNear: {
        // The Add button is the only one with this exact title prefix;
        // selecting by class would be brittle.
        selector: 'button[title^="Add an existing repo"]',
        text: 'Add an existing repo. Pick a repo root, a subdirectory, or a worktree path — treeline resolves to the parent repo.',
      },
    });
    await delay(150);
    await hoverElement(win, 'button[title^="Add an existing repo"]');
  },

  // Settings modal — Appearance (theme + font), Terminal, and the customizable
  // Keybindings section, on factory-default settings.
  '28-settings-modal': async ({ win }) => {
    sendHydrate(win, {
      reset: true,
      repos: [REPO_DASHBOARD, REPO_TREELINE_APP, REPO_CGS],
      worktreesByRepo: ALL_WORKTREES,
      settings: settingsCfg(),
      modal: { kind: 'settings' },
    });
  },

  // Settings modal showing a rejected keybinding: Toggle Sidebar is bound to
  // ⌘V, which is reserved by Paste — the field goes red, the inline message
  // explains why, and Save is disabled.
  '29-settings-keybind-conflict': async ({ win }) => {
    sendHydrate(win, {
      reset: true,
      repos: [REPO_DASHBOARD, REPO_TREELINE_APP, REPO_CGS],
      worktreesByRepo: ALL_WORKTREES,
      settings: settingsCfg({ keybindings: { toggleSidebar: 'CmdOrCtrl+V' } }),
      modal: { kind: 'settings' },
    });
  },

  // App-wide theming: the Light preset repaints the whole chrome (sidebar,
  // tabs, panels), not just the terminal.
  '30-theme-light': async ({ win }) => {
    sendHydrate(win, {
      reset: true,
      repos: [REPO_DASHBOARD, REPO_TREELINE_APP, REPO_CGS],
      worktreesByRepo: ALL_WORKTREES,
      settings: settingsCfg({ terminalTheme: 'graphite-light' }),
    });
  },

  // App-wide theming: the Midnight preset.
  '31-theme-midnight': async ({ win }) => {
    sendHydrate(win, {
      reset: true,
      repos: [REPO_DASHBOARD, REPO_TREELINE_APP, REPO_CGS],
      worktreesByRepo: ALL_WORKTREES,
      settings: settingsCfg({ terminalTheme: 'midnight' }),
    });
  },

  // ── Open Folder: a plain non-git directory pinned to the sidebar ─────────
  // A repo (with its worktrees) sits above a top-level *folder* node —
  // ~/.claude/commands — expanded to its bare, editable file tree. There are no
  // worktrees and no Changed/diff tab for a folder; here review-ideas.md is
  // opened in the rendered Markdown preview beside the terminal.
  '33-open-folder': async (ctx) => {
    const folder: Folder = {
      path: '/Users/example/.claude/commands',
      name: 'commands',
      addedAt: 1_700_000_000_000,
    };
    const entry = (name: string): DirEntry => ({
      name,
      path: `${folder.path}/${name}`,
      type: 'file',
    });
    const file = `${folder.path}/review-ideas.md`;
    const md = [
      '# review-ideas',
      '',
      'Review my ideas & project improvements. This file lives in',
      '`~/.claude/commands` — **outside any git repo** — yet treeline opens it',
      'for browsing and editing all the same.',
      '',
      '## How it works',
      '',
      '- Click **+ Add repo / folder** and pick any directory',
      '- A non-git folder is pinned as a plain file tree (no worktrees)',
      '- Markdown opens in this rendered **Preview**; switch to **File** to edit',
      '',
      '> Tip: ⌘S saves; there is no Changed/diff tab for a plain folder.',
    ].join('\n');

    const { tab, ptyId } = await spawnTabPty(ctx, 'main');
    await waitForPtySettle(ctx, ptyId);
    sendHydrate(ctx.win, {
      reset: true,
      repos: [REPO_TREELINE_APP],
      worktreesByRepo: { [REPO_TREELINE_APP.path]: WORKTREES_TREELINE_APP },
      folders: [folder],
      tabs: [tab],
      activeTabId: tab.id,
      terminalStatus: [{ ptyId: ptyId, status: 'idle', foregroundCmd: null }],
      // Expand the folder's bare tree and pre-load its children. The opened
      // file is highlighted because openFilePath matches its entry path.
      expandedDirs: { [folder.path]: true },
      sidebarFileRoot: folder.path,
      dirChildren: {
        [folder.path]: [
          entry('document-repo.md'),
          entry('ingest-knowledge.md'),
          entry('lint-vault.md'),
          entry('query-notes.md'),
          entry('review-ideas.md'),
        ],
      },
      codePanelOpen: true,
      codePanelWidth: 560,
      openFilePath: file,
      panelMode: 'preview',
      openFileText: md,
    });
    await delay(400);
    await typeAndSettle(ctx, ptyId, ['clear\n', "echo 'open folder'\n"]);
  },
};

// ── Public API ─────────────────────────────────────────────────────────────

export function getScreenshotId(): string | null {
  const v = process.env['TREELINE_SCREENSHOT_ID'];
  return v && v.length > 0 ? v : null;
}

export async function runScreenshot(
  win: BrowserWindow,
  id: string,
  ptyManager: PtyManager | null,
): Promise<void> {
  const setup = SCENARIOS[id];
  if (!setup) {
    console.error(`[screenshot] unknown scenario id: ${id}`);
    console.error(`[screenshot] known: ${Object.keys(SCENARIOS).join(', ')}`);
    app.exit(2);
    return;
  }

  await waitForRendererReady(win, 5000);

  // Park the cursor in the top-left empty gutter so we don't render any
  // element in :hover state by default. Hover scenarios override this.
  win.webContents.sendInputEvent({ type: 'mouseMove', x: 5, y: 5 });

  const ctx: ScenarioCtx = { win, ptyManager, cleanups: [] };

  // Always call `app.exit` — historically this used to live after the try
  // block, which meant a throwing scenario (e.g. hoverElement against a
  // selector that no longer matches) left Electron alive indefinitely. The
  // shell loop then waited forever instead of failing fast. Track exit code
  // explicitly and call exit in the finally.
  let exitCode = 0;
  try {
    await setup(ctx);

    // Two animation frames is enough for Zustand → React → DOM. 250ms is a
    // comfortable upper bound that still keeps the run fast.
    await delay(250);

    const image = await win.webContents.capturePage();
    const outPath = join(__dirname, '..', '..', 'docs', 'img', `${id}.png`);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, image.toPNG());
    // eslint-disable-next-line no-console
    console.log(`[screenshot] saved ${outPath}`);
  } catch (err) {
    exitCode = 1;
    console.error(`[screenshot] scenario ${id} failed:`, err);
  } finally {
    // Best-effort cleanup of PTYs and temp dirs spawned by this scenario.
    for (const fn of ctx.cleanups) {
      await fn().catch(() => {
        /* ignore */
      });
    }
    app.exit(exitCode);
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function sendHydrate(win: BrowserWindow, payload: ScreenshotHydratePayload): void {
  win.webContents.send(Channels.ScreenshotHydrate, payload);
}

async function hoverElement(win: BrowserWindow, selector: string): Promise<void> {
  const result = (await win.webContents.executeJavaScript(
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`,
  )) as { x: number; y: number } | null;

  if (!result) {
    throw new Error(`[screenshot] no element matches selector: ${selector}`);
  }
  win.webContents.sendInputEvent({ type: 'mouseMove', x: result.x, y: result.y });
}

/**
 * Spawn a real PTY inside a fresh mkdtemp directory and return enough metadata
 * to feed into a Tab hydrate payload. Registers cleanup callbacks on the ctx
 * so the PTY is killed and the directory is removed after the capture.
 *
 * The `branchName` is purely cosmetic — it determines the tab title shown
 * in the TabBar (since `Tab.title = basename(cwd)`).
 */
async function spawnTabPty(
  ctx: ScenarioCtx,
  branchName: string,
): Promise<{ tab: Tab; ptyId: string; tmpDir: string }> {
  const { leaf, ptyId, tmpDir } = await spawnLeafPty(ctx, branchName);
  const now = leaf.createdAt;
  const tab: Tab = {
    id: ptyId,
    cwd: leaf.cwd,
    title: branchName,
    root: leaf,
    focusedPaneId: leaf.id,
    createdAt: now,
    lastActiveAt: now,
  };
  return { tab, ptyId, tmpDir };
}

/**
 * Spawn one real PTY (in a fresh mkdtemp dir, clean PS1) and wrap it in a
 * {@link PaneLeaf}. The split-pane scenarios call this several times to build a
 * multi-leaf tree under a single tab. `status`/`foregroundCmd` are baked onto
 * the leaf so PaneView renders the right status dot + badge without needing a
 * separate terminalStatus batch.
 */
async function spawnLeafPty(
  ctx: ScenarioCtx,
  branchName: string,
  opts: { status?: PaneLeaf['status']; foregroundCmd?: string | null } = {},
): Promise<{ leaf: PaneLeaf; ptyId: string; tmpDir: string }> {
  if (!ctx.ptyManager) throw new Error('[screenshot] PtyManager not available');

  const tmpDir = await mkdtemp(join(tmpdir(), `treeline-ss-${branchName}-`));
  // Override PS1 so the prompt is a clean `> ` instead of the user's full
  // shell prompt with paths and git branches that vary by machine. Disable
  // history so background scrollback is empty.
  const env = {
    ...process.env,
    PS1: '> ',
    HISTFILE: '/dev/null',
    PROMPT: '> ',
  } as NodeJS.ProcessEnv;
  const oldEnv = process.env;
  process.env = env;
  let ptyId: string;
  try {
    const spawned = ctx.ptyManager.spawn({ cwd: tmpDir, cols: 100, rows: 24 });
    ptyId = spawned.id;
  } finally {
    process.env = oldEnv;
  }

  const now = Date.now();
  const cwd = `/Users/example/code/treeline-app/${branchName}`;
  const leaf = makeLeaf({
    ptyId,
    cwd,
    title: branchName,
    createdAt: now,
    status: opts.status,
    foregroundCmd: opts.foregroundCmd,
  });

  ctx.cleanups.push(async () => {
    await ctx.ptyManager?.kill(ptyId).catch(() => {
      /* ignore */
    });
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {
      /* ignore */
    });
  });

  return { leaf, ptyId, tmpDir };
}

/** Wrap pane children in a split node with even sizes. */
function split(direction: 'h' | 'v', children: PaneNode[]): PaneNode {
  return {
    kind: 'split',
    id: makeNodeId('split'),
    direction,
    children,
    sizes: children.map(() => 1 / children.length),
  };
}

/**
 * Serve a small, self-contained "dev server" page over HTTP so the embedded
 * browser scenario captures rendered content (not a connection-refused error).
 * Tries port 3000 first so the address bar reads like a real local dev server,
 * falling back to an ephemeral port if it's taken. Registers a cleanup that
 * closes the server after capture.
 */
function startFakeServer(ctx: ScenarioCtx): Promise<string> {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Acme Dashboard · dev</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
         color: #0f172a; background: #f8fafc; }
  header { display: flex; align-items: center; gap: 10px; padding: 14px 22px;
           background: #4f46e5; color: #fff; }
  header .logo { width: 26px; height: 26px; border-radius: 7px; background: #fff;
                 color: #4f46e5; font-weight: 700; display: grid; place-items: center; }
  header strong { font-size: 16px; }
  header .badge { margin-left: auto; font-size: 12px; background: rgba(255,255,255,.18);
                  padding: 3px 9px; border-radius: 999px; }
  main { max-width: 920px; margin: 0 auto; padding: 26px 22px; }
  h1 { font-size: 24px; margin: 0 0 4px; }
  p.sub { margin: 0 0 22px; color: #64748b; }
  .cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-bottom: 24px; }
  .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; }
  .card .k { font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: .04em; }
  .card .v { font-size: 26px; font-weight: 700; margin-top: 6px; }
  .card .d { font-size: 12px; margin-top: 4px; color: #16a34a; }
  table { width: 100%; border-collapse: collapse; background: #fff;
          border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; }
  th, td { text-align: left; padding: 11px 14px; font-size: 14px; border-bottom: 1px solid #eef2f7; }
  th { background: #f1f5f9; color: #475569; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
  tr:last-child td { border-bottom: none; }
  .pill { font-size: 12px; padding: 2px 8px; border-radius: 999px; }
  .ok { background: #dcfce7; color: #166534; }
  .run { background: #dbeafe; color: #1e40af; }
</style>
</head>
<body>
  <header>
    <span class="logo">A</span>
    <strong>Acme Dashboard</strong>
    <span class="badge">localhost:3000 · dev</span>
  </header>
  <main>
    <h1>Welcome back 👋</h1>
    <p class="sub">Vite dev server running — hot reload enabled.</p>
    <section class="cards">
      <div class="card"><div class="k">Active users</div><div class="v">1,284</div><div class="d">▲ 12% this week</div></div>
      <div class="card"><div class="k">Requests / min</div><div class="v">9.4k</div><div class="d">▲ 3% vs avg</div></div>
      <div class="card"><div class="k">Error rate</div><div class="v">0.21%</div><div class="d">▼ 0.05%</div></div>
    </section>
    <table>
      <thead><tr><th>Service</th><th>Region</th><th>Status</th></tr></thead>
      <tbody>
        <tr><td>api-gateway</td><td>us-east-1</td><td><span class="pill ok">healthy</span></td></tr>
        <tr><td>worker-queue</td><td>us-east-1</td><td><span class="pill run">deploying</span></td></tr>
        <tr><td>auth-service</td><td>eu-west-2</td><td><span class="pill ok">healthy</span></td></tr>
      </tbody>
    </table>
  </main>
</body>
</html>`;

  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  });

  ctx.cleanups.push(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  );

  return new Promise<string>((resolve) => {
    const onListening = (s: Server, port: number) => {
      void s;
      resolve(`http://localhost:${port}`);
    };
    server.once('error', () => {
      // Port 3000 taken — retry on an ephemeral port.
      server.listen(0, '127.0.0.1', () =>
        onListening(server, (server.address() as { port: number }).port),
      );
    });
    server.listen(3000, '127.0.0.1', () =>
      onListening(server, (server.address() as { port: number }).port),
    );
  });
}

/**
 * Resolve when the PTY has been quiet for `settleMs` (no `data` events in
 * that window). Used to detect "shell finished initialising" and "command
 * finished running" without fragile fixed delays. Also resolves on the
 * `maxWaitMs` deadline so a misbehaving shell can't hang the harness.
 */
function waitForPtySettle(
  ctx: ScenarioCtx,
  ptyId: string,
  settleMs = 600,
  maxWaitMs = 6000,
): Promise<void> {
  const mgr = ctx.ptyManager;
  if (!mgr) return Promise.resolve();
  return new Promise<void>((resolve) => {
    let lastChunkAt = Date.now();
    const start = Date.now();

    const onData = (e: { id: string }) => {
      if (e.id === ptyId) lastChunkAt = Date.now();
    };
    mgr.on('data', onData);

    const interval = setInterval(() => {
      const now = Date.now();
      const settled = now - lastChunkAt >= settleMs;
      const expired = now - start >= maxWaitMs;
      if (settled || expired) {
        clearInterval(interval);
        mgr.off('data', onData);
        resolve();
      }
    }, 100);
  });
}

/**
 * Write each line into the PTY and wait for the shell to settle between
 * commands. Cheaper than fixed delays for short commands and slow enough
 * for `git --version` etc. to finish printing before the next one starts.
 */
async function typeAndSettle(
  ctx: ScenarioCtx,
  ptyId: string,
  lines: string[],
): Promise<void> {
  for (const line of lines) {
    ctx.ptyManager?.write(ptyId, line);
    await waitForPtySettle(ctx, ptyId, 400, 3000);
  }
}

function waitForRendererReady(win: BrowserWindow, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const onReady = (e: Electron.IpcMainEvent) => {
      if (e.sender !== win.webContents) return;
      ipcMain.off(Channels.ScreenshotReady, onReady);
      clearTimeout(timer);
      resolve();
    };
    ipcMain.on(Channels.ScreenshotReady, onReady);

    const timer = setTimeout(() => {
      // eslint-disable-next-line no-console
      console.warn('[screenshot] renderer-ready signal timed out; capturing anyway');
      ipcMain.off(Channels.ScreenshotReady, onReady);
      resolve();
    }, timeoutMs);
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
