import { describe, expect, it } from 'vitest';
import { create } from 'zustand';
import {
  createEditorSlice,
  type EditorSlice,
  CODE_PANEL_MIN_WIDTH,
  CODE_PANEL_MAX_WIDTH,
} from '../src/renderer/store/editor-slice';

function makeStore() {
  return create<EditorSlice>()((...a) => createEditorSlice(...a));
}

describe('editor-slice', () => {
  it('startFileLoad opens the panel and enters loading for the path', () => {
    const s = makeStore();
    s.getState().startFileLoad('/repo/.env');
    const st = s.getState();
    expect(st.codePanelOpen).toBe(true);
    expect(st.openFilePath).toBe('/repo/.env');
    expect(st.openFileLoading).toBe(true);
    expect(st.openFileText).toBeNull();
  });

  it('applyFileResult populates content for the current file', () => {
    const s = makeStore();
    s.getState().startFileLoad('/repo/.env');
    s.getState().applyFileResult({
      path: '/repo/.env',
      text: 'PORT=3000',
      truncated: false,
      binary: false,
    });
    const st = s.getState();
    expect(st.openFileText).toBe('PORT=3000');
    expect(st.openFileLoading).toBe(false);
  });

  it('applyFileResult ignores a stale result for a file no longer open', () => {
    const s = makeStore();
    s.getState().startFileLoad('/repo/a.ts');
    // User switched before the slow read for the previous file resolved.
    s.getState().startFileLoad('/repo/b.ts');
    s.getState().applyFileResult({
      path: '/repo/a.ts',
      text: 'STALE',
      truncated: false,
      binary: false,
    });
    const st = s.getState();
    expect(st.openFilePath).toBe('/repo/b.ts');
    expect(st.openFileText).toBeNull();
    expect(st.openFileLoading).toBe(true);
  });

  it('setFileError records the error for the current file', () => {
    const s = makeStore();
    s.getState().startFileLoad('/repo/.env');
    s.getState().setFileError('/repo/.env', 'EACCES');
    const st = s.getState();
    expect(st.openFileError).toBe('EACCES');
    expect(st.openFileLoading).toBe(false);
  });

  it('setCodePanelWidth clamps to the allowed range', () => {
    const s = makeStore();
    s.getState().setCodePanelWidth(10_000);
    expect(s.getState().codePanelWidth).toBe(CODE_PANEL_MAX_WIDTH);
    s.getState().setCodePanelWidth(10);
    expect(s.getState().codePanelWidth).toBe(CODE_PANEL_MIN_WIDTH);
  });

  it('tracks directory expansion and cached children independently', () => {
    const s = makeStore();
    s.getState().setDirExpanded('/repo/src', true);
    s.getState().setDirChildren('/repo/src', [
      { name: 'a.ts', path: '/repo/src/a.ts', type: 'file' },
    ]);
    expect(s.getState().expandedDirs['/repo/src']).toBe(true);
    expect(s.getState().dirChildren['/repo/src']).toHaveLength(1);
  });

  it('closeCodePanel hides the panel without clearing the loaded file', () => {
    const s = makeStore();
    s.getState().startFileLoad('/repo/.env');
    s.getState().closeCodePanel();
    expect(s.getState().codePanelOpen).toBe(false);
    expect(s.getState().openFilePath).toBe('/repo/.env');
  });
});
