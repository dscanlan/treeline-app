import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../../src/renderer/store';
import { refreshFileTree, toggleDir } from '../../src/renderer/actions/editor';
import { openSidebarFiles } from '../../src/renderer/actions/sidebar';

const initialState = useStore.getState();
const readDir = vi.fn();

beforeEach(() => {
  useStore.setState(initialState, true);
  useStore.setState({ folders: [{ path: '/Prompts', name: 'Prompts', addedAt: 0 }] });
  readDir.mockReset().mockResolvedValue([]);
  vi.stubGlobal('window', { treeline: { files: { readDir } } });
});

afterEach(() => vi.unstubAllGlobals());

describe('refreshFileTree', () => {
  it('re-reads a folder root that was listed as empty on first open', async () => {
    await openSidebarFiles('/Prompts');
    expect(useStore.getState().dirChildren['/Prompts']).toEqual([]);

    // A file lands on disk (e.g. `touch` from a terminal) while the view is open.
    const entry = { path: '/Prompts/am-scopes.md', name: 'am-scopes.md', type: 'file' as const };
    readDir.mockResolvedValue([entry]);
    expect(useStore.getState().dirChildren['/Prompts']).toEqual([]);

    await refreshFileTree('/Prompts');
    expect(useStore.getState().dirChildren['/Prompts']).toEqual([entry]);
  });

  it('re-reads the root every time the folder view is opened', async () => {
    await openSidebarFiles('/Prompts');
    expect(useStore.getState().dirChildren['/Prompts']).toEqual([]);

    // Removing and re-adding the folder keeps the per-path cache, so the
    // re-open itself must refresh.
    const entry = { path: '/Prompts/am-scopes.md', name: 'am-scopes.md', type: 'file' as const };
    readDir.mockResolvedValue([entry]);
    useStore.getState().setSidebarFileRoot(null);
    await openSidebarFiles('/Prompts');
    expect(useStore.getState().expandedDirs['/Prompts']).toBe(true);
    expect(useStore.getState().dirChildren['/Prompts']).toEqual([entry]);
  });

  it('re-reads expanded subdirectories under the root but not collapsed or foreign ones', async () => {
    await toggleDir('/Prompts');
    await toggleDir('/Prompts/sub');
    await toggleDir('/Prompts/closed');
    useStore.getState().setDirExpanded('/Prompts/closed', false);
    await toggleDir('/Other');
    readDir.mockClear();

    await refreshFileTree('/Prompts');
    expect(readDir.mock.calls.map(([path]) => path).sort()).toEqual(['/Prompts', '/Prompts/sub']);
  });

  it('keeps the previous listing when the re-read fails', async () => {
    const entry = { path: '/Prompts/a.md', name: 'a.md', type: 'file' as const };
    readDir.mockResolvedValue([entry]);
    await toggleDir('/Prompts');
    readDir.mockRejectedValue(new Error('EACCES'));
    await refreshFileTree('/Prompts');
    expect(useStore.getState().dirChildren['/Prompts']).toEqual([entry]);
  });
});
