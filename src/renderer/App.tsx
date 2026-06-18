import { useEffect } from 'react';
import { TitleBar } from './components/TitleBar';
import { Sidebar } from './components/Sidebar';
import { SidebarResizer } from './components/SidebarResizer';
import { MainArea } from './components/MainArea';
import { Modals } from './components/modals/Modals';
import { DiscoveredRepoToast } from './components/DiscoveredRepoToast';
import { WorktreeDriftToast } from './components/WorktreeDriftToast';
import { ScreenshotForceTooltip } from './components/ScreenshotForceTooltip';
import { attachIpc, loadInitialState } from './ipc/client';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts';
import { useAppTheme } from './hooks/useAppTheme';

export function App() {
  useGlobalShortcuts();
  useAppTheme();

  useEffect(() => {
    const detach = attachIpc();
    // Signal main once loadInitialState has fully settled — the screenshot
    // harness waits for this before sending hydrate, otherwise the real
    // config load races the mocked state and overwrites it. Harmless
    // outside screenshot mode (main has no listener registered).
    void loadInitialState().finally(() => {
      window.treeline.screenshot.signalReady();
    });
    return detach;
  }, []);

  return (
    <>
      <div className="flex h-screen w-screen flex-col overflow-hidden">
        <TitleBar />
        <div className="flex min-h-0 flex-1">
          <Sidebar />
          <SidebarResizer />
          <MainArea />
        </div>
      </div>
      <Modals />
      <DiscoveredRepoToast />
      <WorktreeDriftToast />
      <ScreenshotForceTooltip />
    </>
  );
}
