import { execFile, type ExecFileOptions } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface RunResult {
  stdout: string;
  stderr: string;
  /**
   * True when the process was killed for exceeding `timeoutMs`. Callers that
   * use `throwOnError: false` must check this: on a timeout `stdout` is
   * partial/empty, so treating it as a successful (empty) result silently
   * misreports state — e.g. a slow `git status` looking like a clean tree.
   */
  timedOut: boolean;
}

export interface RunOptions {
  cwd?: string;
  /** Hard timeout in ms. Defaults to 15s — git ops should never take longer. */
  timeoutMs?: number;
  /** Throw on non-zero exit. Defaults to true; set false to inspect stderr/stdout regardless. */
  throwOnError?: boolean;
}

export class ProcessError extends Error {
  constructor(
    message: string,
    public stderr: string,
    public stdout: string,
    public code: number | null,
  ) {
    super(message);
    this.name = 'ProcessError';
  }
}

/** Run a binary with argv-style arguments. Never spawns a shell. */
export async function run(
  bin: string,
  args: string[],
  opts: RunOptions = {},
): Promise<RunResult> {
  const { cwd, timeoutMs = 15_000, throwOnError = true } = opts;
  const execOpts: ExecFileOptions = {
    cwd,
    timeout: timeoutMs,
    maxBuffer: 8 * 1024 * 1024, // 8 MB; some `git status` outputs can be large in monorepos
    encoding: 'utf8',
  };
  try {
    const { stdout, stderr } = await execFileAsync(bin, args, execOpts);
    return { stdout: stdout.toString(), stderr: stderr.toString(), timedOut: false };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & {
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      code?: number | string;
      killed?: boolean;
    };
    const stdout = e.stdout?.toString() ?? '';
    const stderr = e.stderr?.toString() ?? '';
    const code = typeof e.code === 'number' ? e.code : null;
    // execFile kills the process (SIGTERM) when it exceeds `timeout`, setting
    // `killed: true` with no numeric exit code. Surface that distinctly.
    const timedOut = e.killed === true && code === null;
    if (throwOnError) {
      const reason = timedOut ? `timed out after ${timeoutMs}ms` : `failed (${code ?? 'unknown'})`;
      throw new ProcessError(
        `${bin} ${args.join(' ')} ${reason}: ${stderr || e.message}`,
        stderr,
        stdout,
        code,
      );
    }
    return { stdout, stderr, timedOut };
  }
}
