import { describe, expect, it } from 'vitest';
import { createStore } from 'zustand/vanilla';
import { createEditorSlice, type EditorSlice } from '@/store/editor-slice';

const makeStore = () => createStore<EditorSlice>()(createEditorSlice);

describe('code-panel file tabs', () => {
  it('opens unique paths in order and activates an existing tab without duplicating it', () => {
    const store = makeStore();
    store.getState().openInPanel('/repo/a.ts', 'file');
    store.getState().openInPanel('/repo/readme.md', 'preview');
    store.getState().openInPanel('/repo/a.ts', 'diff');

    const state = store.getState();
    expect(state.openFilePaths).toEqual(['/repo/a.ts', '/repo/readme.md']);
    expect(state.activeFilePath).toBe('/repo/a.ts');
    expect(state.openFilesByPath['/repo/a.ts'].panelMode).toBe('diff');
  });

  it('preserves each tab mode, loaded text, and draft while switching', () => {
    const store = makeStore();
    store.getState().openInPanel('/repo/a.ts', 'file');
    const requestA = store.getState().beginFileLoad('/repo/a.ts');
    store
      .getState()
      .applyFileResult(
        { path: '/repo/a.ts', text: 'const a = 1;', truncated: false, binary: false },
        requestA,
      );
    store.getState().startEditing('/repo/a.ts');
    store.getState().setDraft('/repo/a.ts', 'const a = 2;');

    store.getState().openInPanel('/repo/readme.md', 'preview');
    const requestMd = store.getState().beginFileLoad('/repo/readme.md');
    store
      .getState()
      .applyFileResult(
        { path: '/repo/readme.md', text: '# Hello', truncated: false, binary: false },
        requestMd,
      );
    store.getState().activateOpenFile('/repo/a.ts');

    const state = store.getState();
    expect(state.openFilesByPath['/repo/a.ts'].draft).toBe('const a = 2;');
    expect(state.openFilesByPath['/repo/a.ts'].editing).toBe(true);
    expect(state.openFilesByPath['/repo/readme.md'].panelMode).toBe('preview');
    expect(state.openFilesByPath['/repo/readme.md'].fileText).toBe('# Hello');
  });

  it('chooses the right neighbour, then the left, and collapses after the last close', () => {
    const store = makeStore();
    for (const path of ['/repo/a', '/repo/b', '/repo/c']) {
      store.getState().openInPanel(path, 'file');
    }
    store.getState().activateOpenFile('/repo/b');
    store.getState().closeOpenFile('/repo/b');
    expect(store.getState().activeFilePath).toBe('/repo/c');

    store.getState().closeOpenFile('/repo/c');
    expect(store.getState().activeFilePath).toBe('/repo/a');
    store.getState().closeOpenFile('/repo/a');
    expect(store.getState().activeFilePath).toBeNull();
    expect(store.getState().codePanelOpen).toBe(false);
  });

  it('applies background results to their own tab and rejects stale generations', () => {
    const store = makeStore();
    store.getState().openInPanel('/repo/a', 'file');
    const stale = store.getState().beginFileLoad('/repo/a');
    const current = store.getState().beginFileLoad('/repo/a');
    store.getState().openInPanel('/repo/b', 'file');

    store
      .getState()
      .applyFileResult({ path: '/repo/a', text: 'stale', truncated: false, binary: false }, stale);
    expect(store.getState().openFilesByPath['/repo/a'].fileText).toBeNull();

    store
      .getState()
      .applyFileResult(
        { path: '/repo/a', text: 'current', truncated: false, binary: false },
        current,
      );
    expect(store.getState().activeFilePath).toBe('/repo/b');
    expect(store.getState().openFilesByPath['/repo/a'].fileText).toBe('current');
  });

  it('ignores a result after its tab has been closed', () => {
    const store = makeStore();
    store.getState().openInPanel('/repo/a', 'file');
    const request = store.getState().beginFileLoad('/repo/a');
    store.getState().closeOpenFile('/repo/a');
    store
      .getState()
      .applyFileResult({ path: '/repo/a', text: 'late', truncated: false, binary: false }, request);
    expect(store.getState().openFilesByPath['/repo/a']).toBeUndefined();
  });

  it('shows two open files simultaneously and targets tab clicks at the focused viewer', () => {
    const store = makeStore();
    store.getState().openInPanel('/repo/a.md', 'preview');
    store.getState().openInPanel('/repo/b.md', 'preview');
    store.getState().openFileInSplit('/repo/a.md');

    expect(store.getState().viewerPanes).toEqual([
      { id: 'primary', path: '/repo/b.md' },
      { id: 'secondary', path: '/repo/a.md' },
    ]);
    expect(store.getState().focusedViewerPaneId).toBe('secondary');

    store.getState().openInPanel('/repo/c.ts', 'file');
    expect(store.getState().viewerPanes).toEqual([
      { id: 'primary', path: '/repo/b.md' },
      { id: 'secondary', path: '/repo/c.ts' },
    ]);
  });

  it('focuses a file already visible in the other viewer instead of duplicating it', () => {
    const store = makeStore();
    store.getState().openInPanel('/repo/a', 'file');
    store.getState().openInPanel('/repo/b', 'file');
    store.getState().openFileInSplit('/repo/a');
    store.getState().activateOpenFile('/repo/b');

    expect(store.getState().viewerPanes).toHaveLength(2);
    expect(store.getState().focusedViewerPaneId).toBe('primary');
    expect(store.getState().activeFilePath).toBe('/repo/b');
  });

  it('collapses a viewer without closing its tab and clamps the divider ratio', () => {
    const store = makeStore();
    store.getState().openInPanel('/repo/a', 'file');
    store.getState().openInPanel('/repo/b', 'file');
    store.getState().openFileInSplit('/repo/a');
    store.getState().setViewerSplitRatio(5);
    expect(store.getState().viewerSplitRatio).toBe(20);
    store.getState().setViewerSplitRatio(95);
    expect(store.getState().viewerSplitRatio).toBe(80);

    store.getState().closeViewerPane('secondary');
    expect(store.getState().viewerPanes).toEqual([{ id: 'primary', path: '/repo/b' }]);
    expect(store.getState().openFilePaths).toEqual(['/repo/a', '/repo/b']);
  });

  it('promotes the secondary viewer when the primary viewer is closed', () => {
    const store = makeStore();
    store.getState().openInPanel('/repo/left.md', 'preview');
    store.getState().openInPanel('/repo/right.md', 'preview');
    store.getState().openFileInSplit('/repo/left.md');

    store.getState().closeViewerPane('primary');

    expect(store.getState().viewerPanes).toEqual([{ id: 'primary', path: '/repo/left.md' }]);
    expect(store.getState().focusedViewerPaneId).toBe('primary');
    expect(store.getState().activeFilePath).toBe('/repo/left.md');
    expect(store.getState().openFilePaths).toEqual(['/repo/left.md', '/repo/right.md']);
  });

  it('closes a background tab without disturbing either visible viewer', () => {
    const store = makeStore();
    for (const path of ['/repo/background', '/repo/left', '/repo/right']) {
      store.getState().openInPanel(path, 'file');
    }
    store.getState().openFileInSplit('/repo/left');
    store.getState().focusViewerPane('primary');
    const panesBefore = store.getState().viewerPanes;

    store.getState().closeOpenFile('/repo/background');

    expect(store.getState().viewerPanes).toEqual(panesBefore);
    expect(store.getState().focusedViewerPaneId).toBe('primary');
    expect(store.getState().activeFilePath).toBe('/repo/right');
    expect(store.getState().openFilePaths).toEqual(['/repo/left', '/repo/right']);
  });

  it('preserves the split and dirty drafts while the whole panel is hidden', () => {
    const store = makeStore();
    store.getState().openInPanel('/repo/left.md', 'preview');
    store.getState().openInPanel('/repo/right.md', 'preview');
    store.getState().openFileInSplit('/repo/left.md');
    store.getState().startEditing('/repo/right.md');
    store.getState().setDraft('/repo/right.md', '# Unsaved');

    store.getState().closeCodePanel();
    expect(store.getState().codePanelOpen).toBe(false);
    expect(store.getState().viewerPanes).toHaveLength(2);
    expect(store.getState().openFilesByPath['/repo/right.md'].draft).toBe('# Unsaved');

    store.getState().activateOpenFile('/repo/right.md');
    expect(store.getState().codePanelOpen).toBe(true);
    expect(store.getState().viewerPanes).toEqual([
      { id: 'primary', path: '/repo/right.md' },
      { id: 'secondary', path: '/repo/left.md' },
    ]);
    expect(store.getState().openFilesByPath['/repo/right.md'].editing).toBe(true);
  });

  it('replaces only the opposite viewer when opening a third tab in an existing split', () => {
    const store = makeStore();
    for (const path of ['/repo/a', '/repo/b', '/repo/c']) {
      store.getState().openInPanel(path, 'file');
    }
    store.getState().openFileInSplit('/repo/b');
    expect(store.getState().viewerPanes).toEqual([
      { id: 'primary', path: '/repo/c' },
      { id: 'secondary', path: '/repo/b' },
    ]);

    store.getState().openFileInSplit('/repo/a');

    expect(store.getState().viewerPanes).toEqual([
      { id: 'primary', path: '/repo/a' },
      { id: 'secondary', path: '/repo/b' },
    ]);
    expect(store.getState().focusedViewerPaneId).toBe('primary');
    expect(store.getState().openFilePaths).toEqual(['/repo/a', '/repo/b', '/repo/c']);
  });

  it('keeps file and diff request generations independent', () => {
    const store = makeStore();
    store.getState().openInPanel('/repo/a', 'file');
    const staleFile = store.getState().beginFileLoad('/repo/a');
    const currentFile = store.getState().beginFileLoad('/repo/a');
    const staleDiff = store.getState().beginDiffLoad('/repo/a');
    const currentDiff = store.getState().beginDiffLoad('/repo/a');

    store.getState().setFileError('/repo/a', staleFile, 'stale file failure');
    store.getState().setDiffError('/repo/a', staleDiff, 'stale diff failure');
    expect(store.getState().openFilesByPath['/repo/a'].fileError).toBeNull();
    expect(store.getState().openFilesByPath['/repo/a'].diffError).toBeNull();

    store
      .getState()
      .applyFileResult(
        { path: '/repo/a', text: 'current file', truncated: false, binary: false },
        currentFile,
      );
    store.getState().setDiffError('/repo/a', currentDiff, 'current diff failure');

    const file = store.getState().openFilesByPath['/repo/a'];
    expect(file.fileText).toBe('current file');
    expect(file.fileLoading).toBe(false);
    expect(file.diffError).toBe('current diff failure');
    expect(file.diffLoading).toBe(false);
  });

  it('keeps a newer draft dirty when an earlier save completes', () => {
    const store = makeStore();
    store.getState().openInPanel('/repo/a', 'file');
    const request = store.getState().beginFileLoad('/repo/a');
    store
      .getState()
      .applyFileResult(
        { path: '/repo/a', text: 'before', truncated: false, binary: false },
        request,
      );
    store.getState().startEditing('/repo/a');
    store.getState().setDraft('/repo/a', 'submitted');
    store.getState().setSaving('/repo/a', true);
    store.getState().setDraft('/repo/a', 'typed while saving');

    store.getState().applySaved('/repo/a', 'submitted');

    const file = store.getState().openFilesByPath['/repo/a'];
    expect(file.fileText).toBe('submitted');
    expect(file.draft).toBe('typed while saving');
    expect(file.draft).not.toBe(file.fileText);
    expect(file.saving).toBe(false);
    expect(file.editing).toBe(true);
  });
});
