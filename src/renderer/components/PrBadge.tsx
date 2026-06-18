import type { PrChecks, PrInfo, PrState } from '@shared/types';

interface Props {
  pr: PrInfo;
}

/** Badge color per PR state, using the app's theme tokens. */
const STATE_COLOR: Record<PrState, string> = {
  open: 'text-treeline-green',
  draft: 'text-treeline-dim',
  merged: 'text-treeline-magenta',
  closed: 'text-treeline-red',
};

const STATE_LABEL: Record<PrState, string> = {
  open: 'open',
  draft: 'draft',
  merged: 'merged',
  closed: 'closed',
};

/** CI rollup glyph + color. */
const CHECK_GLYPH: Record<PrChecks, { glyph: string; color: string; label: string }> = {
  passing: { glyph: '✓', color: 'text-treeline-green', label: 'checks passing' },
  failing: { glyph: '✗', color: 'text-treeline-red', label: 'checks failing' },
  pending: { glyph: '●', color: 'text-treeline-yellow', label: 'checks pending' },
};

/**
 * Linked-PR badge for a worktree's branch: the PR number colored by state
 * (open/draft/merged/closed) plus an optional CI rollup glyph. Clicking opens
 * the PR on GitHub via `system.openExternal` (routed through main's safe-url
 * allowlist). A `<button>` with stopPropagation so the click doesn't also
 * trigger the row's open-tab handler.
 */
export function PrBadge({ pr }: Props) {
  const check = pr.checks ? CHECK_GLYPH[pr.checks] : null;
  const title = `#${pr.number} · ${STATE_LABEL[pr.state]}${check ? ` · ${check.label}` : ''}`;

  return (
    <button
      type="button"
      data-ss="worktree-pr"
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        void window.treeline.system.openExternal(pr.url);
      }}
      className={`flex items-center gap-0.5 rounded border border-current px-1 py-px text-[10px] hover:bg-treeline-surface ${
        STATE_COLOR[pr.state]
      }`}
    >
      <span>#{pr.number}</span>
      {check && <span className={check.color}>{check.glyph}</span>}
    </button>
  );
}
