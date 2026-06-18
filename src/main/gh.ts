// GitHub PR lookup via the `gh` CLI. A thin sibling to `git.ts`: reuses the
// `run()` exec wrapper and the user's existing `gh auth` — no token handling.
// Pure of Electron imports so it's unit-testable like `git.ts` / `git-porcelain`.

import type { PrChecks, PrInfo, PrState } from '@shared/types';
import { run } from './util/exec';

const GH = 'gh';

/**
 * Cap on PRs fetched per repo. We list `--state all` so merged/closed branches
 * still resolve; 100 is plenty for a working repo and keeps the JSON small.
 */
const PR_LIMIT = 100;

/** Network call — give it more room than the default 15s git timeout. */
const GH_TIMEOUT_MS = 20_000;

/**
 * Memoized `gh` availability probe. The binary either exists on PATH or it
 * doesn't for the life of the process, so probe once. `null` = not yet probed.
 */
let ghAvailableCache: boolean | null = null;

/** True if the `gh` CLI is installed and on PATH. Result is memoized. */
export async function ghAvailable(): Promise<boolean> {
  if (ghAvailableCache !== null) return ghAvailableCache;
  const { stdout, timedOut } = await run(GH, ['--version'], {
    throwOnError: false,
    timeoutMs: 5_000,
  });
  ghAvailableCache = !timedOut && stdout.toLowerCase().includes('gh version');
  return ghAvailableCache;
}

/** Test seam: reset the memoized availability probe. */
export function resetGhAvailableCache(): void {
  ghAvailableCache = null;
}

// ── JSON shape returned by `gh pr list --json …` ────────────────────────────

interface GhCheckRun {
  /** Completed runs: SUCCESS | FAILURE | CANCELLED | TIMED_OUT | NEUTRAL | SKIPPED | … */
  conclusion?: string;
  /** In-flight runs: QUEUED | IN_PROGRESS | PENDING | COMPLETED | … */
  status?: string;
  /** Legacy commit-status contexts use `state` instead: SUCCESS | FAILURE | PENDING | … */
  state?: string;
}

interface GhPr {
  number: number;
  /** OPEN | CLOSED | MERGED */
  state: string;
  isDraft: boolean;
  headRefName: string;
  url: string;
  statusCheckRollup?: GhCheckRun[] | null;
}

const FAILING = new Set([
  'FAILURE',
  'CANCELLED',
  'TIMED_OUT',
  'ERROR',
  'ACTION_REQUIRED',
  'STARTUP_FAILURE',
]);
const PENDING = new Set(['QUEUED', 'IN_PROGRESS', 'PENDING', 'WAITING', 'REQUESTED', 'EXPECTED']);

/**
 * Reduce a PR's per-check rollup to one badge state. Precedence: any failing →
 * failing; else any pending/in-flight → pending; else (all success/neutral/
 * skipped) → passing. Empty/absent rollup → null (PR has no checks).
 */
export function rollupChecks(runs: GhCheckRun[] | null | undefined): PrChecks | null {
  if (!runs || runs.length === 0) return null;
  let sawPending = false;
  for (const r of runs) {
    // A run is either completed (has `conclusion`) or in-flight (`status` not
    // COMPLETED). Legacy commit statuses report via `state`.
    const concl = (r.conclusion ?? r.state ?? '').toUpperCase();
    const stat = (r.status ?? '').toUpperCase();
    if (stat && stat !== 'COMPLETED') {
      sawPending = true;
      continue;
    }
    if (FAILING.has(concl)) return 'failing';
    if (PENDING.has(concl) || PENDING.has(stat)) sawPending = true;
  }
  return sawPending ? 'pending' : 'passing';
}

/** Map gh's `state` + `isDraft` to our {@link PrState}. */
function toPrState(state: string, isDraft: boolean): PrState {
  switch (state.toUpperCase()) {
    case 'MERGED':
      return 'merged';
    case 'CLOSED':
      return 'closed';
    default:
      return isDraft ? 'draft' : 'open';
  }
}

/**
 * Parse `gh pr list --json …` stdout into a branch→PrInfo map. Pure (no IO) so
 * it's straightforward to unit-test. Malformed/empty JSON yields `{}`.
 */
export function parsePrList(raw: string): Record<string, PrInfo> {
  let prs: GhPr[];
  try {
    prs = JSON.parse(raw) as GhPr[];
  } catch {
    return {};
  }
  if (!Array.isArray(prs)) return {};

  const out: Record<string, PrInfo> = {};
  for (const pr of prs) {
    if (!pr || typeof pr.headRefName !== 'string' || typeof pr.number !== 'number') continue;
    // If two PRs share a head branch (e.g. an open one and an older closed
    // one), keep the first: gh lists newest first, so the most-recent wins.
    if (out[pr.headRefName]) continue;
    out[pr.headRefName] = {
      number: pr.number,
      state: toPrState(pr.state, pr.isDraft),
      url: pr.url,
      checks: rollupChecks(pr.statusCheckRollup),
    };
  }
  return out;
}

/**
 * List pull requests for the repo at `repoPath`, keyed by head branch. Returns
 * `{}` (silent degrade) when `gh` is unavailable, the repo has no GitHub
 * remote, the user isn't authenticated, or the call fails/times out — all of
 * which surface as a non-zero exit. PR status is a nice-to-have overlay, never
 * a hard dependency.
 */
export async function listPullRequests(repoPath: string): Promise<Record<string, PrInfo>> {
  if (!(await ghAvailable())) return {};
  const { stdout, timedOut } = await run(
    GH,
    [
      'pr',
      'list',
      '--state',
      'all',
      '--limit',
      String(PR_LIMIT),
      '--json',
      'number,state,isDraft,headRefName,url,statusCheckRollup',
    ],
    { cwd: repoPath, throwOnError: false, timeoutMs: GH_TIMEOUT_MS },
  );
  if (timedOut || stdout.trim().length === 0) return {};
  return parsePrList(stdout);
}
