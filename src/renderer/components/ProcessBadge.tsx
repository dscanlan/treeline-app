import { AGENTS } from '@shared/agents';
import type { DetectedProcess } from '@shared/types';

interface Props {
  proc: DetectedProcess;
}

/**
 * Badge for an AI CLI detected running in a worktree. The agent's registry
 * colour when active (magenta for every kind today), dim when idle (no CPU
 * change for ≥10s — see ProcessMonitor).
 */
export function ProcessBadge({ proc }: Props) {
  const baseColor = proc.idle ? 'text-treeline-dim' : AGENTS[proc.kind].colorClass;
  return (
    <span
      title={`${proc.kind} (pid ${proc.pid})${proc.idle ? ' — idle' : ''}`}
      className={`rounded border border-current px-1 py-px text-[10px] uppercase ${baseColor}`}
    >
      {proc.kind}
      {proc.idle && <span className="ml-1 text-[9px]">idle</span>}
    </span>
  );
}
