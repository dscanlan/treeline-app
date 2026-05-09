import type { StateCreator } from 'zustand';
import type { DetectedProcess } from '@shared/types';

export interface ProcessesSlice {
  processes: DetectedProcess[];
  /** cwd-keyed index for fast lookups in WorktreeRow. */
  processesByWorktreePath: Record<string, DetectedProcess[]>;

  setProcesses: (procs: DetectedProcess[], byWorktreePath: Record<string, DetectedProcess[]>) => void;
}

export const createProcessesSlice: StateCreator<ProcessesSlice, [], [], ProcessesSlice> = (
  set,
) => ({
  processes: [],
  processesByWorktreePath: {},
  setProcesses: (processes, processesByWorktreePath) =>
    set({ processes, processesByWorktreePath }),
});
