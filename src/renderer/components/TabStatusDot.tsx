import { useEffect, useRef, useState } from 'react';
import type { TabStatus } from '@shared/types';

interface Props {
  status: TabStatus;
  /** Optional size in px. */
  size?: number;
}

/**
 * 6px dot using the Treeline palette:
 * - running → green
 * - idle    → cyan
 * - exited  → dim
 *
 * On a `running → idle` transition, briefly pulse green for ~800ms to signal
 * "just finished".
 */
export function TabStatusDot({ status, size = 6 }: Props) {
  const prev = useRef<TabStatus>(status);
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    if (prev.current === 'running' && status === 'idle') {
      setPulse(true);
      const t = window.setTimeout(() => setPulse(false), 800);
      return () => window.clearTimeout(t);
    }
    prev.current = status;
  }, [status]);

  let color: string;
  if (pulse) color = 'bg-treeline-green';
  else if (status === 'running') color = 'bg-treeline-green';
  else if (status === 'idle') color = 'bg-treeline-cyan';
  else color = 'bg-treeline-dim';

  return (
    <span
      role="status"
      aria-label={status}
      className={`inline-block shrink-0 rounded-full ${color} ${pulse ? 'animate-pulse' : ''}`}
      style={{ width: size, height: size }}
    />
  );
}
