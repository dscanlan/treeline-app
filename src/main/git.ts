import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ChangedFile, ChangedFileStatus, DiffLine, FileDiff, Worktree } from '@shared/types';
import { detectClaudeWorktree } from '@shared/claude-detect';
import { parseWorktreePorcelain } from './git-porcelain';
import { readFileGuarded } from './files-io';
import { ProcessError, run, type RunOptions, type RunResult } from './util/exec';

const GIT = 'git';

/**
 * Run git with `--no-optional-locks`. Treeline spawns `git status` constantly
 * in the background (worktree watcher, Changed-view poll), and a plain
 * `git status` opportunistically rewrites the index to refresh its stat cache,
 * taking `index.lock` each time. That lock races against the user's own git
 * commands (`git reset` fails with "index.lock: File exists") and, because the
 * lock file lives in `.git/`, every status also re-triggers our fs.watch on
 * that directory — a self-sustaining refresh loop. `--no-optional-locks`
 * (git ≥ 2.15) skips only these opportunistic writes; commands that genuinely
 * mutate state still take their mandatory locks as usual.
 */
function git(args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return run(GIT, ['--no-optional-locks', ...args], opts);
}

/**
 * Timeout for working-tree status calls. `git status` enumerates every
 * untracked path, which on a large or slow tree (deep node_modules, many
 * untracked dirs, a slow filesystem) can take well over the default 15s — git
 * itself warns "It took N seconds to enumerate untracked files." A too-tight
 * timeout kills the process and yields empty output, which would otherwise be
 * misread as a clean tree. 60s gives ample headroom.
 */
const STATUS_TIMEOUT_MS = 60_000;

/** True if the given path is the root (or under) a git working tree. */
export async function isGitRepo(path: string): Promise<boolean> {
  try {
    const { stdout } = await git(['rev-parse', '--show-toplevel'], {
      cwd: path,
      throwOnError: false,
    });
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

/** Returns the toplevel of the repo containing `path`, or null if not in a repo. */
export async function repoRootAt(path: string): Promise<string | null> {
  const { stdout } = await git(['rev-parse', '--show-toplevel'], {
    cwd: path,
    throwOnError: false,
  });
  const trimmed = stdout.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Resolves any path inside a git repo to the **parent** working tree —
 * `cgs/.claude/worktrees/foo` → `cgs`, `cgs/src/util` → `cgs`, `cgs` → `cgs`.
 *
 * Implemented via `git rev-parse --git-common-dir`, which always points at the
 * shared `.git` directory regardless of whether `path` is a main checkout, a
 * subdirectory, or a linked worktree. Returns null if `path` is not inside any
 * git repository. For bare repos, returns the `.git` directory itself (callers
 * may want to surface that as an error rather than tracking it; treeline's
 * worktree flow doesn't currently make sense for bare repos).
 */
export async function resolveParentRepoPath(path: string): Promise<string | null> {
  // `--path-format=absolute` is supported since git 2.31 (March 2021); macOS's
  // bundled git is newer than that. Without it, common-dir is sometimes printed
  // relative to cwd, which leads to wrong dirname() results.
  const { stdout } = await git(
    ['rev-parse', '--path-format=absolute', '--git-common-dir', '--is-bare-repository'],
    { cwd: path, throwOnError: false },
  );
  // Output is two lines: <abs path to common .git dir> then <true|false>.
  const lines = stdout.trim().split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return null;
  const commonDir = lines[0]!;
  const isBare = lines[1] === 'true';
  if (!commonDir) return null;
  return isBare ? commonDir : dirname(commonDir);
}

/** True if the worktree at `path` has any uncommitted or untracked changes. */
export async function isDirty(path: string): Promise<boolean> {
  const { stdout } = await git(['status', '--porcelain'], {
    cwd: path,
    throwOnError: false,
    timeoutMs: STATUS_TIMEOUT_MS,
  });
  return stdout.length > 0;
}

/** Map a `git status --porcelain` two-char XY code to a display category. */
function categorizeStatus(xy: string): ChangedFileStatus {
  if (xy === '??') return 'untracked';
  const x = xy[0];
  const y = xy[1];
  if (x === 'U' || y === 'U' || xy === 'AA' || xy === 'DD') return 'conflicted';
  if (x === 'R' || y === 'R') return 'renamed';
  if (x === 'A' || y === 'A') return 'added';
  if (x === 'D' || y === 'D') return 'deleted';
  return 'modified';
}

/** Strip git's optional double-quoting (used for paths with special chars). */
function unquotePath(p: string): string {
  if (p.startsWith('"') && p.endsWith('"')) {
    try {
      return JSON.parse(p) as string;
    } catch {
      return p.slice(1, -1);
    }
  }
  return p;
}

/**
 * Working-tree changes for the worktree at `path` (the Source-Control view):
 * modified, staged, deleted, renamed, and untracked files via
 * `git status --porcelain`. `core.quotepath=false` keeps non-ASCII names
 * readable; the result is sorted by relative path.
 */
export async function changedFiles(path: string): Promise<ChangedFile[]> {
  const { stdout, timedOut } = await git(
    ['-c', 'core.quotepath=false', 'status', '--porcelain'],
    { cwd: path, throwOnError: false, timeoutMs: STATUS_TIMEOUT_MS },
  );
  // A timeout yields empty stdout; reporting that as "no changes" would hide a
  // dirty tree. Throw so the renderer keeps the last known list instead.
  if (timedOut) throw new Error(`git status timed out for ${path}`);

  const files: ChangedFile[] = [];
  for (const line of stdout.split('\n')) {
    // Each entry is "XY <path>"; the path starts at column 3.
    if (line.length < 4) continue;
    const xy = line.slice(0, 2);
    let rest = line.slice(3);
    // For renames/copies porcelain prints "old -> new"; we want the new name.
    if (xy[0] === 'R' || xy[0] === 'C') {
      const arrow = rest.indexOf(' -> ');
      if (arrow >= 0) rest = rest.slice(arrow + 4);
    }
    const relPath = unquotePath(rest);
    // Git collapses an untracked directory into one `?? dir/` entry; the
    // trailing slash is our signal that `path` is a directory, not a file.
    const isDir = relPath.endsWith('/');
    files.push({
      path: join(path, relPath),
      relPath,
      status: categorizeStatus(xy),
      isDir,
    });
  }

  files.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return files;
}

/**
 * Parse a unified `git diff` into structured rows, tracking old/new line
 * numbers across hunks. Pure (no IO) so it's straightforward to unit-test.
 */
export function parseUnifiedDiff(path: string, raw: string): FileDiff {
  const lines: DiffLine[] = [];
  let added = 0;
  let removed = 0;
  let binary = false;
  let oldLine = 0;
  let newLine = 0;
  // The `--- a/file` / `+++ b/file` headers start with -/+ too, so only parse
  // body lines once we're inside a hunk.
  let inHunk = false;

  for (const row of raw.split('\n')) {
    if (row.startsWith('Binary files')) {
      binary = true;
      continue;
    }
    if (row.startsWith('@@')) {
      const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(row);
      if (m) {
        oldLine = parseInt(m[1]!, 10);
        newLine = parseInt(m[2]!, 10);
        lines.push({ kind: 'hunk', oldLine: null, newLine: null, text: m[3]!.trim() });
        inHunk = true;
      }
      continue;
    }
    // Header noise (diff --git, index, ---, +++, mode/rename lines) precedes
    // the first hunk — ignore everything until then.
    if (!inHunk || row.length === 0) continue;
    const marker = row[0];
    const body = row.slice(1);
    if (marker === '+') {
      lines.push({ kind: 'add', oldLine: null, newLine, text: body });
      newLine++;
      added++;
    } else if (marker === '-') {
      lines.push({ kind: 'del', oldLine, newLine: null, text: body });
      oldLine++;
      removed++;
    } else if (marker === ' ') {
      lines.push({ kind: 'context', oldLine, newLine, text: body });
      oldLine++;
      newLine++;
    }
    // '\' (no newline at eof) and file headers fall through, ignored.
  }

  return { path, lines, added, removed, binary };
}

/** Build an all-additions diff for an untracked file from its contents. */
async function untrackedAsDiff(absPath: string): Promise<FileDiff> {
  const fc = await readFileGuarded(absPath);
  if (fc.binary) return { path: absPath, lines: [], added: 0, removed: 0, binary: true };
  const contentLines = fc.text.split('\n');
  // Drop the trailing empty element produced by a final newline.
  if (contentLines.length > 0 && contentLines[contentLines.length - 1] === '') {
    contentLines.pop();
  }
  const lines: DiffLine[] = contentLines.map((text, i) => ({
    kind: 'add',
    oldLine: null,
    newLine: i + 1,
    text,
  }));
  return { path: absPath, lines, added: lines.length, removed: 0, binary: false };
}

/**
 * Unified diff of the file at `absPath`: working tree vs HEAD. Untracked files
 * (which `git diff` ignores) are rendered as all-additions from their contents.
 */
export async function fileDiff(absPath: string): Promise<FileDiff> {
  const dir = dirname(absPath);
  const { stdout: status } = await git(
    ['-c', 'core.quotepath=false', 'status', '--porcelain', '--', absPath],
    { cwd: dir, throwOnError: false },
  );
  if (status.startsWith('??')) return untrackedAsDiff(absPath);

  const { stdout } = await git(
    ['-c', 'core.quotepath=false', 'diff', '--no-color', 'HEAD', '--', absPath],
    { cwd: dir, throwOnError: false },
  );
  return parseUnifiedDiff(absPath, stdout);
}

/**
 * List worktrees in the repo at `repoPath`. Stale entries (where the on-disk
 * path is gone) are filtered out, matching Treeline's `build_worktree`
 * behaviour at git.rs:148-170.
 */
export async function listWorktreesIn(repoPath: string): Promise<Worktree[]> {
  const { stdout } = await git(['worktree', 'list', '--porcelain'], {
    cwd: repoPath,
  });

  const records = parseWorktreePorcelain(stdout);

  // Filter out stale entries (non-bare with no on-disk path) before the dirty
  // check so we don't waste a subprocess on each.
  const live = records.filter((r) => r.isBare || existsSync(r.path));

  // Run dirty checks in parallel.
  const dirtyResults = await Promise.all(
    live.map((r) => (r.isBare ? Promise.resolve(false) : isDirty(r.path))),
  );

  return live.map((r, i) => ({
    path: r.path,
    branch: r.branch,
    commit: r.commit,
    isBare: r.isBare,
    isDirty: dirtyResults[i] ?? false,
    isCurrent: false,
    isClaude: detectClaudeWorktree(r.path, r.branch),
  }));
}

/**
 * Create a worktree. If the branch already exists, retry without `-b`, matching
 * the Rust fallback at git.rs:207-229.
 */
export async function createWorktree(
  repoPath: string,
  path: string,
  branch: string,
): Promise<void> {
  try {
    await git(['worktree', 'add', '-b', branch, path], { cwd: repoPath });
    return;
  } catch (err) {
    if (err instanceof ProcessError && err.stderr.includes('already exists')) {
      // Branch exists — reuse it on the new worktree path.
      await git(['worktree', 'add', path, branch], { cwd: repoPath });
      return;
    }
    throw err;
  }
}

/** Force-remove a worktree. */
export async function removeWorktree(path: string): Promise<void> {
  // `git worktree remove` resolves the repo from the cwd, not from the argument.
  // Run from inside the worktree itself — it still exists on disk at this
  // point, and from there git can locate the parent gitdir.
  await git(['worktree', 'remove', '--force', path], { cwd: path });
}

/**
 * Initialize a fresh git repo at `path` on the given branch. `git init -b` has
 * been supported since git 2.28 (Jul 2020) — macOS bundled git is newer.
 *
 * Caller is responsible for ensuring `path` exists and is NOT already a repo;
 * `git init` is idempotent so re-running on an existing repo would silently
 * succeed, which would be a surprising UX. The IPC layer (repos-create.ts)
 * enforces the not-already-a-repo precondition.
 */
export async function initRepo(path: string, branch: string): Promise<void> {
  await git(['init', '-b', branch], { cwd: path });
}
