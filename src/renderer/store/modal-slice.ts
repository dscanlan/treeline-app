import type { StateCreator } from 'zustand';

export type Modal =
  | { kind: 'create-worktree'; repoPath: string }
  | { kind: 'delete-worktree'; repoPath: string; worktreePath: string; branch: string }
  | null;

export interface ModalSlice {
  modal: Modal;
  openModal: (m: Exclude<Modal, null>) => void;
  closeModal: () => void;
}

export const createModalSlice: StateCreator<ModalSlice, [], [], ModalSlice> = (set) => ({
  modal: null,
  openModal: (m) => set({ modal: m }),
  closeModal: () => set({ modal: null }),
});
