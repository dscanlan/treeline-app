import { spawn } from 'node:child_process';
import { isAbsolute, join } from 'node:path';
import type {
  ContentSearchOptions,
  ContentSearchResult,
  SearchFileResult,
  SearchLineMatch,
  SearchSubmatch,
} from '@shared/types';

/**
 * Content + filename search over a single worktree/folder, powered by ripgrep.
 *
 * This module is **electron-free and pure** so it unit-tests against the real
 * `rg` binary without booting Electron — the IPC layer (`ipc/search.ts`)
 * resolves the binary path (which *is* electron-dependent, packaged vs dev) and
 * passes it in. Mirrors the `git.ts` / `files-io.ts` split: side-effecting
 * core here, path validation in the IPC wrapper.
 */

/** Per-file match cap handed to rg (`--max-count`). Keeps one hot file sane. */
const MAX_MATCHES_PER_FILE = 200;
/** Hard ceiling on total matches we parse/return — protects the renderer. */
const MAX_TOTAL_MATCHES = 5000;
/** Byte ceiling on rg stdout; hitting it kills rg and flags `truncated`. */
const MAX_STDOUT_BYTES = 16 * 1024 * 1024;
/** rg `--max-columns`: truncate absurdly long lines (minified bundles etc.). */
const MAX_COLUMNS = 1000;
/** Cap on files returned by {@link listFiles} — bounds the quick-open list. */
const MAX_FILES = 20_000;
/** Wall-clock timeout for a single rg invocation. */
const SEARCH_TIMEOUT_MS = 20_000;

interface RgRunResult {
  stdout: string;
  /** rg exit code (0 = matches, 1 = no matches, 2 = error), or null if killed. */
  code: number | null;
  /** True if we killed rg for exceeding the byte cap or timing out. */
  truncated: boolean;
  timedOut: boolean;
}

/**
 * Spawn rg and collect stdout up to {@link MAX_STDOUT_BYTES}, killing it early
 * if it overruns. We use `spawn` (not the shared `run()`/`execFile`) precisely
 * because search output is unbounded — execFile's fixed `maxBuffer` would throw
 * ENOBUFS on a large result instead of letting us degrade to a truncated set.
 */
function runRg(rgPath: string, args: string[], cwd: string): Promise<RgRunResult> {
  return new Promise((resolve) => {
    // stdin 'ignore' so rg can never block waiting on stdin (it reads stdin when
    // given no path + a piped stdin); we always pass an explicit path anyway.
    const child = spawn(rgPath, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    let bytes = 0;
    let truncated = false;
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, SEARCH_TIMEOUT_MS);

    child.stdout.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_STDOUT_BYTES) {
        if (!truncated) {
          truncated = true;
          child.kill('SIGTERM');
        }
        return;
      }
      chunks.push(chunk);
    });
    // Drain stderr so the pipe never blocks; rg writes here on bad regex etc.
    child.stderr.on('data', () => {});

    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout: Buffer.concat(chunks).toString('utf8'), code, truncated, timedOut });
    };

    child.on('close', (code) => finish(code));
    // ENOENT (rg missing) etc. — surface as an error result the caller maps.
    child.on('error', () => finish(null));
  });
}

/** Convert a ripgrep byte offset into a UTF-16 string index within `line`. */
function byteOffsetToCharIndex(line: string, byteOffset: number): number {
  if (byteOffset <= 0) return 0;
  const slice = Buffer.from(line, 'utf8').subarray(0, byteOffset).toString('utf8');
  return slice.length;
}

/**
 * Parse ripgrep's `--json` NDJSON stream into per-file results. Pure and
 * exported for unit testing. Stops accumulating once {@link MAX_TOTAL_MATCHES}
 * is reached and reports that via the returned `capped` flag.
 *
 * `root` is the search root; rg is run with `cwd: root` and the path arg `.`,
 * so each event's `path.text` is relative to it — we keep that as `relPath` and
 * join it onto `root` for the absolute `path`.
 */
export function parseRgJson(
  stdout: string,
  root: string,
): { results: SearchFileResult[]; totalMatches: number; capped: boolean } {
  const byFile = new Map<string, SearchFileResult>();
  let totalMatches = 0;
  let capped = false;

  for (const raw of stdout.split('\n')) {
    if (raw.length === 0) continue;
    let evt: unknown;
    try {
      evt = JSON.parse(raw);
    } catch {
      continue; // partial line from a killed rg, or non-JSON noise
    }
    const e = evt as { type?: string; data?: Record<string, unknown> };
    if (e.type !== 'match' || !e.data) continue;
    if (totalMatches >= MAX_TOTAL_MATCHES) {
      capped = true;
      break;
    }

    const data = e.data as {
      path?: { text?: string };
      lines?: { text?: string };
      line_number?: number;
      submatches?: { match?: { text?: string }; start?: number; end?: number }[];
    };
    const relPath = data.path?.text?.replace(/^\.\//, '');
    const lineText = data.lines?.text;
    const lineNumber = data.line_number;
    // Skip non-UTF8 lines (rg emits `lines.bytes` instead of `text`) and any
    // malformed event — a content search has nothing useful to show for them.
    if (typeof relPath !== 'string' || typeof lineText !== 'string' || typeof lineNumber !== 'number')
      continue;

    const text = lineText.replace(/\r?\n$/, '');
    const submatches: SearchSubmatch[] = (data.submatches ?? [])
      .map((sm) => {
        const mtext = sm.match?.text;
        if (typeof mtext !== 'string' || typeof sm.start !== 'number' || typeof sm.end !== 'number')
          return null;
        return {
          text: mtext,
          start: byteOffsetToCharIndex(text, sm.start),
          end: byteOffsetToCharIndex(text, sm.end),
        } satisfies SearchSubmatch;
      })
      .filter((sm): sm is SearchSubmatch => sm !== null);

    let file = byFile.get(relPath);
    if (!file) {
      file = { path: join(root, relPath), relPath, matches: [] };
      byFile.set(relPath, file);
    }
    const match: SearchLineMatch = { line: lineNumber, text, submatches };
    file.matches.push(match);
    totalMatches += 1;
  }

  return { results: [...byFile.values()], totalMatches, capped };
}

/**
 * Search file contents under `root`. Literal-substring by default; set
 * `opts.regex` to treat `query` as a regex. Respects `.gitignore` (rg default)
 * so build output / node_modules are skipped, and works equally in a git
 * worktree or a plain folder.
 */
export async function searchContent(
  rgPath: string,
  root: string,
  query: string,
  opts: ContentSearchOptions = {},
): Promise<ContentSearchResult> {
  if (!isAbsolute(root)) throw new Error('search root must be absolute');
  if (query.length === 0) return { results: [], totalMatches: 0, truncated: false };

  const args = [
    '--json',
    `--max-count=${MAX_MATCHES_PER_FILE}`,
    `--max-columns=${MAX_COLUMNS}`,
    '--max-columns-preview',
    // Apply .gitignore even outside a git repo so a plain non-git folder's
    // ignore file is still honoured (rg otherwise requires a .git dir).
    '--no-require-git',
  ];
  if (!opts.regex) args.push('--fixed-strings');
  if (opts.wholeWord) args.push('--word-regexp');
  args.push(opts.caseSensitive ? '--case-sensitive' : '--smart-case');
  // `--` terminates flags so a query starting with `-` isn't read as one. The
  // explicit `.` path is required: with no path arg and a piped (non-tty) stdin
  // — which is the case under spawn — rg reads from STDIN and hangs. The `./`
  // prefix it adds to results is stripped in parseRgJson.
  args.push('--', query, '.');

  const { stdout, code, truncated, timedOut } = await runRg(rgPath, args, root);
  // rg exit 1 = "no matches" (normal). 2 / null = a real failure.
  if (code === 2 || (code === null && !truncated && !timedOut)) {
    throw new Error('ripgrep failed — check the search pattern');
  }

  const { results, totalMatches, capped } = parseRgJson(stdout, root);
  return { results, totalMatches, truncated: truncated || timedOut || capped };
}

/**
 * Enumerate files under `root` (rg `--files`, so `.gitignore` is respected).
 * Returns paths relative to `root`, for the fuzzy quick-open list. Capped at
 * {@link MAX_FILES}.
 */
export async function listFiles(rgPath: string, root: string): Promise<string[]> {
  if (!isAbsolute(root)) throw new Error('search root must be absolute');
  // The explicit `.` path matters: without it, rg under spawn reads stdin and
  // hangs (see searchContent). The `./` prefix is stripped below.
  const { stdout, code, timedOut } = await runRg(rgPath, ['--files', '--no-require-git', '.'], root);
  if (code === null && !timedOut) throw new Error('ripgrep failed to list files');
  const files = stdout
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => line.replace(/^\.\//, ''));
  return files.length > MAX_FILES ? files.slice(0, MAX_FILES) : files;
}
