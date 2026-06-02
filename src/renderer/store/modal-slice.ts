import type { StateCreator } from 'zustand';

/**
 * What to do after the user discards unsaved edits. Encoded as plain data (not a
 * callback) so the modal state stays serializable like the others; the editor
 * actions map it back to the real navigation.
 */
export type DiscardThen =
  | { type: 'open-file'; path: string }
  | { type: 'open-diff'; path: string }
  | { type: 'close-panel' }
  | { type: 'stop-editing' };

export type Modal =
  | { kind: 'create-worktree'; repoPath: string }
  | { kind: 'delete-worktree'; repoPath: string; worktreePath: string; branch: string }
  | { kind: 'create-repo' }
  | { kind: 'confirm-discard'; filename: string; then: DiscardThen }
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
