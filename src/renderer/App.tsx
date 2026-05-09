import { useEffect } from 'react';
import { TitleBar } from './components/TitleBar';
import { Sidebar } from './components/Sidebar';
import { MainArea } from './components/MainArea';
import { Modals } from './components/modals/Modals';
import { attachIpc, loadInitialState } from './ipc/client';

export function App() {
  useEffect(() => {
    const detach = attachIpc();
    void loadInitialState();
    return detach;
  }, []);

  return (
    <>
      <div className="flex h-screen w-screen flex-col overflow-hidden">
        <TitleBar />
        <div className="flex min-h-0 flex-1">
          <Sidebar />
          <MainArea />
        </div>
      </div>
      <Modals />
    </>
  );
}
