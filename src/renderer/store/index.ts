import { create } from 'zustand';
import { createReposSlice, type ReposSlice } from './repos-slice';
import { createTabsSlice, type TabsSlice } from './tabs-slice';
import { createProcessesSlice, type ProcessesSlice } from './processes-slice';
import { createModalSlice, type ModalSlice } from './modal-slice';

export type AppStore = ReposSlice & TabsSlice & ProcessesSlice & ModalSlice;

export const useStore = create<AppStore>()((...a) => ({
  ...createReposSlice(...a),
  ...createTabsSlice(...a),
  ...createProcessesSlice(...a),
  ...createModalSlice(...a),
}));
