import { create } from 'zustand';
import { createReposSlice, type ReposSlice } from './repos-slice';
import { createTabsSlice, type TabsSlice } from './tabs-slice';
import { createProcessesSlice, type ProcessesSlice } from './processes-slice';
import { createModalSlice, type ModalSlice } from './modal-slice';
import { createDiscoveriesSlice, type DiscoveriesSlice } from './discoveries-slice';
import { createDriftSlice, type DriftSlice } from './drift-slice';
import { createHandoffSlice, type HandoffSlice } from './handoff-slice';
import { createScreenshotSlice, type ScreenshotSlice } from './screenshot-slice';
import { createScratchSlice, type ScratchSlice } from './scratch-slice';
import { createEditorSlice, type EditorSlice } from './editor-slice';
import { createBrowserSlice, type BrowserSlice } from './browser-slice';
import { createNotesSlice, type NotesSlice } from './notes-slice';
import { createSettingsSlice, type SettingsSlice } from './settings-slice';
import { createReattachSlice, type ReattachSlice } from './reattach-slice';
import { createRestoreSlice, type RestoreSlice } from './restore-slice';
import { createSearchSlice, type SearchSlice } from './search-slice';
import { createVaultSlice, type VaultSlice } from './vault-slice';

export type AppStore = ReposSlice &
  TabsSlice &
  ProcessesSlice &
  ModalSlice &
  DiscoveriesSlice &
  DriftSlice &
  HandoffSlice &
  ScreenshotSlice &
  ScratchSlice &
  EditorSlice &
  BrowserSlice &
  NotesSlice &
  SettingsSlice &
  ReattachSlice &
  RestoreSlice &
  SearchSlice &
  VaultSlice;

export const useStore = create<AppStore>()((...a) => ({
  ...createReposSlice(...a),
  ...createTabsSlice(...a),
  ...createProcessesSlice(...a),
  ...createModalSlice(...a),
  ...createDiscoveriesSlice(...a),
  ...createDriftSlice(...a),
  ...createHandoffSlice(...a),
  ...createScreenshotSlice(...a),
  ...createScratchSlice(...a),
  ...createEditorSlice(...a),
  ...createBrowserSlice(...a),
  ...createNotesSlice(...a),
  ...createSettingsSlice(...a),
  ...createReattachSlice(...a),
  ...createRestoreSlice(...a),
  ...createSearchSlice(...a),
  ...createVaultSlice(...a),
}));
