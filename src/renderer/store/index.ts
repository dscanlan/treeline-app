import { create } from 'zustand';
import { createReposSlice, type ReposSlice } from './repos-slice';
import { createTabsSlice, type TabsSlice } from './tabs-slice';
import { createProcessesSlice, type ProcessesSlice } from './processes-slice';
import { createModalSlice, type ModalSlice } from './modal-slice';
import { createDiscoveriesSlice, type DiscoveriesSlice } from './discoveries-slice';
import { createScreenshotSlice, type ScreenshotSlice } from './screenshot-slice';
import { createScratchSlice, type ScratchSlice } from './scratch-slice';
import { createEditorSlice, type EditorSlice } from './editor-slice';
import { createBrowserSlice, type BrowserSlice } from './browser-slice';
import { createSettingsSlice, type SettingsSlice } from './settings-slice';

export type AppStore = ReposSlice &
  TabsSlice &
  ProcessesSlice &
  ModalSlice &
  DiscoveriesSlice &
  ScreenshotSlice &
  ScratchSlice &
  EditorSlice &
  BrowserSlice &
  SettingsSlice;

export const useStore = create<AppStore>()((...a) => ({
  ...createReposSlice(...a),
  ...createTabsSlice(...a),
  ...createProcessesSlice(...a),
  ...createModalSlice(...a),
  ...createDiscoveriesSlice(...a),
  ...createScreenshotSlice(...a),
  ...createScratchSlice(...a),
  ...createEditorSlice(...a),
  ...createBrowserSlice(...a),
  ...createSettingsSlice(...a),
}));
