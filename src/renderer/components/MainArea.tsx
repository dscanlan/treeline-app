import { useStore } from '../store';
import { TabBar } from './TabBar';
import { TerminalHost } from './TerminalHost';
import { CodePanel } from './CodePanel';
import { CodePanelResizer } from './CodePanelResizer';
import { BrowserPane } from './BrowserPane';
import { BrowserPanelResizer } from './BrowserPanelResizer';

export function MainArea() {
  const codePanelOpen = useStore((s) => s.codePanelOpen);
  const codePanelWidth = useStore((s) => s.codePanelWidth);
  const browserPanelOpen = useStore((s) => s.browserPanelOpen);
  const browserPanelWidth = useStore((s) => s.browserPanelWidth);

  return (
    <main className="flex min-w-0 flex-1 flex-col bg-treeline-surface">
      <TabBar />
      {/* Terminal area and the optional code panel sit side by side; the tab
        * bar spans both. The terminal keeps flex-1 so it reflows as the panel
        * opens, resizes, or closes (its ResizeObserver refits xterm). */}
      <div className="flex min-h-0 flex-1">
        <TerminalHost />
        {codePanelOpen && (
          <>
            <CodePanelResizer />
            <div className="shrink-0" style={{ width: codePanelWidth }}>
              <CodePanel />
            </div>
          </>
        )}
        {browserPanelOpen && (
          <>
            <BrowserPanelResizer />
            <div className="shrink-0" style={{ width: browserPanelWidth }}>
              <BrowserPane />
            </div>
          </>
        )}
      </div>
    </main>
  );
}
