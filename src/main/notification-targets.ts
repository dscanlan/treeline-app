/**
 * The slice of `PtyManager` needed to resolve a notification to pane(s).
 * Declared structurally so the resolver is unit-testable without Electron.
 */
export interface PaneLocator {
  /** True if a PTY with this id is still registered. */
  has(id: string): boolean;
  /** Ids of all live panes. */
  shellPids(): { id: string; shellPid: number }[];
  /** Last-known cwd of a pane, or undefined. */
  cwdOf(id: string): string | undefined;
}

/**
 * Resolve which pane(s) an agent-attention notification (`treeline notify`)
 * should light. Returns the pane ids to target — possibly empty, in which case
 * the caller should fall back to a window-level toast that claims no pane.
 *
 *   1. **Exact pane id** (from the `TREELINE_PANE_ID` env var treeline exports
 *      into every shell it spawns; the Claude Code hook reports it back). Always
 *      unambiguous — pinpoints the one pane even when several tabs share a cwd.
 *   2. **cwd, but only when unique.** Claude fires some notifications from a
 *      process that does NOT inherit the pane's `TREELINE_PANE_ID` (e.g. a
 *      follow-up `Notification` a few seconds after the first), so a pane id
 *      can't be guaranteed. cwd alone can match SEVERAL panes (two tabs open on
 *      the same directory); lighting them all flags the wrong agent — the bug
 *      this guards against. So we light a cwd match ONLY when it resolves to
 *      exactly one pane. 0 or >1 candidates → `[]` (toast instead).
 *
 * The cwd match prefers an exact-equality hit, then falls back to containment
 * (shell in the worktree root, agent in a subdir, or vice-versa) so a
 * not-pixel-identical cwd still resolves.
 */
export function resolveNotificationTargets(
  mgr: PaneLocator,
  opts: { cwd?: string; paneId?: string },
): string[] {
  const { cwd, paneId } = opts;
  if (paneId && mgr.has(paneId)) return [paneId];
  if (!cwd) return [];

  const ids = mgr.shellPids().map((p) => p.id);
  const exact = ids.filter((id) => mgr.cwdOf(id) === cwd);
  const candidates =
    exact.length > 0
      ? exact
      : ids.filter((id) => {
          const pc = mgr.cwdOf(id);
          return !!pc && (cwd.startsWith(pc + '/') || pc.startsWith(cwd + '/'));
        });

  // Ambiguous (0 or many) → don't light any pane; let the caller toast.
  return candidates.length === 1 ? candidates : [];
}
