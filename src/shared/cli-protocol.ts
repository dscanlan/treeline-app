// Wire protocol for the scriptable CLI + socket API (see the
// `treeline-app-scriptable-cli` idea note). A `treeline` CLI binary talks to
// the running app over a unix domain socket; this module is the single source
// of truth for the message shapes and is imported by BOTH main (the server)
// and the renderer (which receives forwarded `open` commands).
//
// IMPORTANT: this file is imported by the sandboxed preload bridge indirectly,
// so it must stay free of Node built-ins (`node:net`, `node:os`, …). Keep it
// pure data + string helpers.

/**
 * Verbs the socket server understands. v1 intentionally small — `ping` for
 * health checks, read-only `repos`/`worktrees` introspection, and the two
 * verbs the idea names as the unblockers: `notify` (feeds agent notifications)
 * and `open` (open/focus a worktree tab, the headline cmux verb).
 */
export const CLI_VERBS = [
  'ping',
  'repos',
  'worktrees',
  'notify',
  'open',
  'send',
  // Drive the embedded browser pane:
  // `browser navigate|eval|screenshot|snapshot|query|click|fill`. The
  // sub-action rides in args.action (the wire verb stays a flat identifier).
  'browser',
] as const;
export type CliVerb = (typeof CLI_VERBS)[number];

/** One request line: `{verb,args}\n`. */
export interface CliRequest {
  verb: string;
  args?: Record<string, unknown>;
}

export interface CliResponseOk {
  ok: true;
  data?: unknown;
}

export interface CliResponseErr {
  ok: false;
  error: string;
}

export type CliResponse = CliResponseOk | CliResponseErr;

/**
 * Command forwarded from main → renderer over IPC when a socket verb needs the
 * UI to act (the socket server itself lives in main and has no store access):
 * `open` focuses/opens a worktree tab; `send` types into the focused terminal;
 * `browser-navigate` opens the browser pane and points it at `url` (opening the
 * pane is React state, so it must go through the renderer — unlike eval/
 * screenshot, which main runs directly against the guest webContents).
 */
export type CliRendererCommand =
  | { verb: 'open'; cwd: string }
  | { verb: 'send'; text: string }
  | { verb: 'browser-navigate'; url: string };

/**
 * Encode a message as a single newline-delimited JSON frame. Both directions
 * speak NDJSON so a connection can carry a request then a response with simple
 * line buffering and no length prefixes.
 */
export function encodeFrame(msg: CliRequest | CliResponse): string {
  return JSON.stringify(msg) + '\n';
}
