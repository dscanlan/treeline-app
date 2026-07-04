// The shared agent registry — the single place per-agent knowledge lives.
// Main and renderer both read this; keep it dependency-free and pure (no
// Electron, no node:*) because it is bundled into the renderer, like
// `claude-detect.ts` before it.
//
// Adding an agent = adding an entry here (plus extending the AgentKind
// union). Consumers derive labels, glyphs, colours, process detection and
// worktree conventions from the entry instead of hard-coding them.
//
// NOTE: Tailwind only generates classes it finds literally in scanned
// sources, and this file is on the scan list (tailwind.config.ts `content`)
// precisely so the `colorClass` strings below survive purging. Keep them as
// plain string literals.

export type AgentKind = 'claude' | 'opencode' | 'aider';

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
   * Capability slots — filled in by later roadmap ideas. Absence of a
   * capability means the feature is not offered for that agent
   * (capability-gating, not pretending).
   */
  resume: null; // → per-agent resume commands
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
    resume: null,
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
    resume: null,
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
    resume: null,
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
