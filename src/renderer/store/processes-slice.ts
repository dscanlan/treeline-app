import type { StateCreator } from 'zustand';
import type { DetectedProcess } from '@shared/types';

export interface ProcessesSlice {
  processes: DetectedProcess[];
  /** cwd-keyed index for fast lookups in WorktreeRow. */
  processesByWorktreePath: Record<string, DetectedProcess[]>;
  /** Worktree-path-keyed listening ports (deduped, sorted ascending). */
  portsByWorktreePath: Record<string, number[]>;

  setProcesses: (
    procs: DetectedProcess[],
    byWorktreePath: Record<string, DetectedProcess[]>,
    portsByWorktreePath: Record<string, number[]>,
  ) => void;
}

export const createProcessesSlice: StateCreator<ProcessesSlice, [], [], ProcessesSlice> = (
  set,
) => ({
  processes: [],
  processesByWorktreePath: {},
  portsByWorktreePath: {},
  setProcesses: (processes, processesByWorktreePath, portsByWorktreePath) =>
    set({ processes, processesByWorktreePath, portsByWorktreePath }),
});
