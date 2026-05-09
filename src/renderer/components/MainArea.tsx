import { TabBar } from './TabBar';
import { TerminalHost } from './TerminalHost';

export function MainArea() {
  return (
    <main className="flex min-w-0 flex-1 flex-col bg-treeline-surface">
      <TabBar />
      <TerminalHost />
    </main>
  );
}
