// The shared agent registry — the single place per-agent knowledge lives.
// Main and renderer both read this; keep it dependency-free and pure (no
// Electron, no node:*) because it is bundled into the renderer, like
// `claude-detect.ts` before it.
//
// Adding an agent = adding an entry here (plus extending the AgentKind
// union). Consumers derive labels, glyphs, colours, process detection,
// worktree conventions and resume commands from the entry instead of
// hard-coding them.
//
// NOTE: Tailwind only generates classes it finds literally in scanned
// sources, and this file is on the scan list (tailwind.config.ts `content`)
// precisely so the `colorClass` strings below survive purging. Keep them as
// plain string literals.

export type AgentKind = 'claude' | 'opencode' | 'aider';
// codex: detection has not landed (no `codex` process basename below) — when
// it does, add a fourth entry; `codex resume <id>` is the verified resume
// shape (checked against codex CLI, 2026-07).

/**
 * How an agent resumes a saved session. Commands are pure string builders so
 * they can live in shared/ (renderer-safe). SECURITY: a session id is later
 * typed into a shell — NEVER interpolate an id that fails
 * {@link ResumeCapability.isValidSessionId}; {@link buildRestoreCommand}
 * enforces this, matching the filename-shaped guard on the CLI socket verb
 * (`cli-handlers.ts`).
 */
export interface ResumeCapability {
  /**
   * Build the command that resumes session `id` in the pane's cwd. Absent
   * when the agent has no id-based resume (aider's history is cwd-keyed).
   */
  restore?(id: string): string;
  /** Build the fork/branch variant used by worktree handoff; absent = no handoff offer. */
  fork?(id: string): string;
  /** Strict validator for ids that will be typed into a shell. */
  isValidSessionId(id: string): boolean;
  /**
   * The literal command resuming with no explicit id (cwd-keyed history),
   * e.g. `aider --restore-chat-history`. Used when no valid pinned id exists.
   */
  resumeWithoutId?: string;
}

/**
 * Filename-shaped ids only (Claude's are UUIDs; opencode's are `ses_…`) —
 * identical to the guard on the CLI socket's session-report verb. Anything a
 * shell could interpret (spaces, quotes, `;`, `$`, …) fails.
 */
const FILENAME_SHAPED_ID = /^[A-Za-z0-9._-]{1,128}$/;
const isFilenameShapedId = (id: string): boolean => FILENAME_SHAPED_ID.test(id);

export interface AgentDefinition {
  kind: AgentKind;
  /** Human label: 'Claude', 'opencode', 'aider'. */
  label: string;
  /** Sidebar glyph, e.g. '✦' for Claude. */
  glyph: string;
  /** Tailwind text-colour class for glyph/label/badges. */
  colorClass: string;
  /** Dimmed variant of {@link colorClass}, for group headings. */
  colorClassDim: string;
  /** Stable ordering for grouped sidebar sections and pickers. */
  order: number;
  /** Process basenames that identify this agent (feeds ProcessMonitor). */
  processBasenames: string[];
  /** Static worktree convention, or null if the agent has none. */
  worktreeDetect: ((absPath: string, branch: string) => boolean) | null;
  /**
   * Capability slots — filled in by roadmap ideas as they land. Absence of a
   * capability means the feature is not offered for that agent
   * (capability-gating, not pretending).
   */
  /** How to resume this agent's sessions, or null → restore as a plain shell. */
  resume: ResumeCapability | null;
  sessionStore: null; // → per-agent session stores (main-process registry)
  hooks: null; // → per-agent hook wiring (CLI side)
}

export const AGENTS: Record<AgentKind, AgentDefinition> = {
  claude: {
    kind: 'claude',
    label: 'Claude',
    glyph: '✦',
    colorClass: 'text-treeline-magenta',
    colorClassDim: 'text-treeline-magenta/70',
    order: 0,
    processBasenames: ['claude'],
    // Mirrors the Claude-worktree rule ported from the Rust TUI
    // (treeline/src/git.rs:19-22): a worktree counts as Claude's if its
    // on-disk path lives under `.claude/worktrees/` or its branch uses the
    // `worktree-*` convention.
    worktreeDetect: (absPath, branch) =>
      absPath.includes('/.claude/worktrees/') || branch.startsWith('worktree-'),
    resume: {
      restore: (id) => `claude --resume ${id}`,
      // --fork-session gives the resumed copy its own id so the original
      // conversation stays untouched (worktree handoff relies on this).
      fork: (id) => `claude --resume ${id} --fork-session`,
      isValidSessionId: isFilenameShapedId,
    },
    sessionStore: null,
    hooks: null,
  },
  opencode: {
    kind: 'opencode',
    label: 'opencode',
    glyph: '⬡',
    colorClass: 'text-treeline-magenta',
    colorClassDim: 'text-treeline-magenta/70',
    order: 1,
    processBasenames: ['opencode'],
    worktreeDetect: null,
    // Verified against the installed opencode CLI (2026-07): `--session <id>`
    // continues that session; `--fork` forks when continuing. Handoff is still
    // not offered for opencode — that additionally needs a session store with
    // copy support (see WorktreeDriftToast gating).
    resume: {
      restore: (id) => `opencode --session ${id}`,
      fork: (id) => `opencode --session ${id} --fork`,
      isValidSessionId: isFilenameShapedId,
    },
    sessionStore: null,
    hooks: null,
  },
  aider: {
    kind: 'aider',
    label: 'aider',
    glyph: '◆',
    colorClass: 'text-treeline-magenta',
    colorClassDim: 'text-treeline-magenta/70',
    order: 2,
    processBasenames: ['aider'],
    worktreeDetect: null,
    // aider has no session ids: chat history is a cwd-keyed file
    // (.aider.chat.history.md), so resume is id-less. Flag documented in
    // aider's manual (not binary-verified — aider isn't installed here).
    resume: {
      isValidSessionId: () => false,
      resumeWithoutId: 'aider --restore-chat-history',
    },
    sessionStore: null,
    hooks: null,
  },
};

/** Every registry entry, in stable `order`. */
export const AGENT_LIST: AgentDefinition[] = Object.values(AGENTS).sort(
  (a, b) => a.order - b.order,
);

/** Process basename → agent kind (feeds ProcessMonitor's ps scan). */
export const KIND_BY_BASENAME: Record<string, AgentKind> = Object.fromEntries(
  AGENT_LIST.flatMap((a) => a.processBasenames.map((b) => [b, a.kind])),
);

/**
 * Which agent (if any) claims this worktree by static convention. Checked in
 * registry `order`; today only Claude declares a convention, so behaviour is
 * identical to the old `detectClaudeWorktree`.
 */
export function detectAgentWorktree(absPath: string, branch: string): AgentKind | null {
  for (const agent of AGENT_LIST) {
    if (agent.worktreeDetect?.(absPath, branch)) return agent.kind;
  }
  return null;
}

/**
 * The restore command for a pane persisted as `kind`, given the pinned (or
 * freshly resolved) session id — or null when nothing should be typed and the
 * pane stays a plain shell at its saved cwd. This is the single funnel every
 * restore write goes through, so the injection guard cannot be bypassed: an
 * id failing the agent's validator is treated as absent (falling back to the
 * agent's id-less resume, if any), never interpolated.
 */
export function buildRestoreCommandFor(
  cap: ResumeCapability | null,
  id: string | null | undefined,
): string | null {
  if (!cap) return null;
  if (id && cap.restore && cap.isValidSessionId(id)) return cap.restore(id);
  return cap.resumeWithoutId ?? null;
}

/** {@link buildRestoreCommandFor}, looked up from the registry by kind. */
export function buildRestoreCommand(
  kind: AgentKind,
  id: string | null | undefined,
): string | null {
  return buildRestoreCommandFor(AGENTS[kind].resume, id);
}
