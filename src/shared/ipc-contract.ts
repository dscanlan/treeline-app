import type {
  AppConfig,
  ProcessSnapshot,
  Repo,
  TabStatus,
  TerminalStatusUpdate,
  Worktree,
} from './types';

// The shape exposed to the renderer via contextBridge as `window.treeline`.
export interface TreelineApi {
  repos: {
    list(): Promise<Repo[]>;
    add(absPath: string): Promise<Repo>;
    remove(absPath: string): Promise<void>;
    pickDirectory(): Promise<string | null>;
  };

  worktrees: {
    list(repoPath: string): Promise<Worktree[]>;
    create(repoPath: string, branch: string, path: string): Promise<void>;
    remove(path: string): Promise<void>;
    /** Subscribe to worktree-changed events. Returns an unsubscribe fn. */
    onChange(cb: (repoPath: string) => void): () => void;
  };

  pty: {
    spawn(opts: {
      cwd: string;
      shell?: string;
      cols: number;
      rows: number;
    }): Promise<{ id: string }>;
    write(id: string, data: string): void;
    resize(id: string, cols: number, rows: number): void;
    kill(id: string): Promise<void>;
    onData(id: string, cb: (chunk: string) => void): () => void;
    onExit(
      id: string,
      cb: (info: { code: number; signal: number | null }) => void,
    ): () => void;
  };

  processes: {
    snapshot(): Promise<ProcessSnapshot>;
    subscribe(cb: (snapshot: ProcessSnapshot) => void): () => void;
  };

  terminalStatus: {
    subscribe(cb: (updates: TerminalStatusUpdate[]) => void): () => void;
  };

  config: {
    get(): Promise<AppConfig>;
    setCodeRoot(p: string | null): Promise<void>;
    setSidebarCollapsed(v: boolean): Promise<void>;
  };

  window: {
    /** Subscribe to the ⌘B accelerator from the main process. */
    onSidebarToggle(cb: () => void): () => void;
  };
}

declare global {
  interface Window {
    treeline: TreelineApi;
  }
}

// Re-export status type for callers that import "the IPC types" only.
export type { TabStatus };
