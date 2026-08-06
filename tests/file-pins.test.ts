import { describe, expect, it } from 'vitest';
import {
  containingFilePinRoot,
  pathIsInside,
  pinnedFileContext,
  sanitizePinnedFilePaths,
  togglePinnedFilePath,
  type FilePinRoot,
} from '../src/shared/file-pins';

const roots: FilePinRoot[] = [
  { path: '/code/app', label: 'main' },
  { path: '/code/app/worktrees/auth', label: 'feat/auth' },
  { path: '/notes', label: 'notes' },
];

describe('file pins', () => {
  it('sanitizes malformed persisted values and preserves newest-first order', () => {
    expect(
      sanitizePinnedFilePaths([
        '/notes/today.md',
        123,
        'relative.txt',
        '/code/app/README.md',
        '/notes/today.md',
      ]),
    ).toEqual(['/notes/today.md', '/code/app/README.md']);
    expect(sanitizePinnedFilePaths({ path: '/nope' })).toEqual([]);
  });

  it('prepends new pins, removes existing pins, and re-pins at the top', () => {
    const initial = ['/a/old.ts', '/b/older.ts'];
    expect(togglePinnedFilePath(initial, '/c/new.ts')).toEqual([
      '/c/new.ts',
      '/a/old.ts',
      '/b/older.ts',
    ]);
    expect(togglePinnedFilePath(initial, '/a/old.ts')).toEqual(['/b/older.ts']);
    expect(togglePinnedFilePath(['/b/older.ts'], '/a/old.ts')).toEqual([
      '/a/old.ts',
      '/b/older.ts',
    ]);
  });

  it('checks containment on path boundaries', () => {
    expect(pathIsInside('/code/app/src/index.ts', '/code/app')).toBe(true);
    expect(pathIsInside('/code/application/index.ts', '/code/app')).toBe(false);
    expect(pathIsInside('/code/app', '/code/app/')).toBe(true);
  });

  it('uses the longest containing root', () => {
    expect(containingFilePinRoot('/code/app/worktrees/auth/src/login.ts', roots)?.label).toBe(
      'feat/auth',
    );
    expect(containingFilePinRoot('/elsewhere/file.ts', roots)).toBeNull();
  });

  it('builds compact context and falls back when a root is removed', () => {
    expect(pinnedFileContext('/code/app/src/components/Tree.tsx', roots)).toBe(
      'main · src/components',
    );
    expect(pinnedFileContext('/notes/today.md', roots)).toBe('notes');
    expect(pinnedFileContext('/removed/project/README.md', roots)).toBe('/removed/project');
  });
});
