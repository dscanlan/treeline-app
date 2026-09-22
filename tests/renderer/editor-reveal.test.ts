import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../../src/renderer/store';
import {
  activateOpenFile,
  openFileAtLine,
  openFileInPanel,
} from '../../src/renderer/actions/editor';

const initialState = useStore.getState();
const readDir = vi.fn();
const read = vi.fn();

beforeEach(() => {
  useStore.setState(initialState, true);
  useStore.setState({
    folders: [{ path: '/repo', name: 'repo', addedAt: 0 }],
  });
  readDir.mockReset().mockResolvedValue([]);
  read.mockReset().mockImplementation(async (path: string) => ({ path, text: 'hello' }));
  vi.stubGlobal('window', { treeline: { files: { readDir, read } } });
});

afterEach(() => vi.unstubAllGlobals());

describe('reveal opened files', () => {
  it('reveals a nested search hit from a collapsed tree without losing the line target', async () => {
    useStore.setState({ searchRoot: '/repo', worktreeFileView: { '/repo': 'changed' } });
    await openFileAtLine('/repo/src/components/widget.ts', 12);
    const s = useStore.getState();
    expect(s.sidebarFileRoot).toBe('/repo');
    expect(s.worktreeFileView['/repo']).toBe('all');
    expect(s.expandedDirs).toEqual({
      '/repo': true,
      '/repo/src': true,
      '/repo/src/components': true,
    });
    expect(readDir.mock.calls.map(([path]) => path)).toEqual([
      '/repo',
      '/repo/src',
      '/repo/src/components',
    ]);
    expect(s.activeFilePath).toBe('/repo/src/components/widget.ts');
    expect(s.openFilesByPath[s.activeFilePath!].revealLine).toBe(12);
  });

  it('reopens collapsed ancestors and refreshes stale directory listings', async () => {
    useStore.setState({ dirChildren: { '/repo': [], '/repo/src': [] } });
    await openFileInPanel('/repo/src/new.ts');
    useStore.getState().setDirExpanded('/repo/src', false);
    readDir.mockResolvedValue([{ path: '/repo/src/new.ts', name: 'new.ts', type: 'file' }]);
    await openFileInPanel('/repo/src/new.ts');
    expect(useStore.getState().expandedDirs['/repo/src']).toBe(true);
    expect(useStore.getState().dirChildren['/repo/src']).toHaveLength(1);
  });

  it('reveals a file when returning to its existing tab', async () => {
    await openFileInPanel('/repo/src/a.ts');
    await openFileInPanel('/repo/b.ts');
    useStore.getState().setDirExpanded('/repo/src', false);
    activateOpenFile('/repo/src/a.ts');
    expect(useStore.getState().expandedDirs['/repo/src']).toBe(true);
    expect(useStore.getState().activeFilePath).toBe('/repo/src/a.ts');
  });

  it('chooses the most specific root and respects path boundaries', async () => {
    useStore.setState({
      folders: [
        { path: '/repo', name: 'repo', addedAt: 0 },
        { path: '/repo/nested', name: 'nested', addedAt: 0 },
      ],
    });
    await openFileInPanel('/repo/nested/file.ts');
    expect(useStore.getState().sidebarFileRoot).toBe('/repo/nested');
    readDir.mockClear();
    await openFileInPanel('/repository/file.ts');
    expect(readDir).not.toHaveBeenCalled();
    expect(useStore.getState().sidebarFileRoot).toBe('/repo/nested');
  });

  it('supports search roots outside the catalog and root-level files', async () => {
    useStore.setState({ searchRoot: '/scratch' });
    await openFileAtLine('/scratch/file.ts', 1);
    expect(useStore.getState().sidebarFileRoot).toBe('/scratch');
    expect(readDir).toHaveBeenCalledTimes(1);
    expect(readDir).toHaveBeenCalledWith('/scratch');
  });

  it('keeps opening files when directory reads fail and preserves cached children', async () => {
    const cached = [{ path: '/repo/old.ts', name: 'old.ts', type: 'file' as const }];
    useStore.setState({ dirChildren: { '/repo': cached } });
    readDir.mockRejectedValue(new Error('unavailable'));
    await openFileAtLine('/repo/src/new.ts', 3);
    expect(useStore.getState().dirChildren['/repo']).toEqual(cached);
    expect(useStore.getState().dirChildren['/repo/src']).toEqual([]);
    expect(useStore.getState().openFilesByPath['/repo/src/new.ts'].fileText).toBe('hello');
  });

  it('does not let slow directory reads take selection back from a newer open', async () => {
    let finish!: (entries: []) => void;
    readDir.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    await openFileAtLine('/repo/old/file.ts', 1);
    useStore.setState({ searchRoot: '/other' });
    await openFileAtLine('/other/new.ts', 2);
    finish([]);
    await Promise.resolve();
    expect(useStore.getState().sidebarFileRoot).toBe('/other');
    expect(useStore.getState().activeFilePath).toBe('/other/new.ts');
  });
});
