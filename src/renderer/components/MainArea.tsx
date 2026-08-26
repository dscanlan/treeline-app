import { useStore } from '../store';
import { TabBar } from './TabBar';
import { TerminalHost } from './TerminalHost';
import { CodePanel } from './CodePanel';
import { CodePanelResizer } from './CodePanelResizer';
import { BrowserPane } from './BrowserPane';
import { BrowserPanelResizer } from './BrowserPanelResizer';
import { NotesPanel } from './NotesPanel';
import { NotesPanelResizer } from './NotesPanelResizer';
import { SearchPanel } from './SearchPanel';
import { SearchPanelResizer } from './SearchPanelResizer';

export function MainArea() {
  const codePanelOpen = useStore((s) => s.codePanelOpen);
  const codePanelWidth = useStore((s) => s.codePanelWidth);
  const browserPanelOpen = useStore((s) => s.browserPanelOpen);
  const browserPanelWidth = useStore((s) => s.browserPanelWidth);
  const notesPanelOpen = useStore((s) => s.notesPanelOpen);
  const notesPanelWidth = useStore((s) => s.notesPanelWidth);
  const searchPanelOpen = useStore((s) => s.searchPanelOpen);
  const searchPanelWidth = useStore((s) => s.searchPanelWidth);
  // The scratchpad and the embedded browser share the right-hand aux slot
  // (toggling one closes the other in client.ts). The `!browserPanelOpen` guard
  // is belt-and-braces: if the browser is opened by another path (e.g. a port
  // chip) while the scratchpad is open, the browser wins and the scratchpad
  // hides (its text is preserved) rather than stacking a third panel.
  const showNotes = notesPanelOpen && !browserPanelOpen;

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
            {/* The drag clamps to 90% of the free space; this is the backstop
              * for the cases no drag is involved — a restored width from a
              * wider window, or the window being resized smaller afterwards. */}
            <div className="min-w-0 shrink-0" style={{ width: codePanelWidth, maxWidth: '90%' }}>
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
        {showNotes && (
          <>
            <NotesPanelResizer />
            <div className="shrink-0" style={{ width: notesPanelWidth }}>
              <NotesPanel />
            </div>
          </>
        )}
        {/* Find-in-files results sit on the far right and coexist with the code
          * panel (a result click opens the file in CodePanel beside them). */}
        {searchPanelOpen && (
          <>
            <SearchPanelResizer />
            <div className="shrink-0" style={{ width: searchPanelWidth }}>
              <SearchPanel />
            </div>
          </>
        )}
      </div>
    </main>
  );
}
