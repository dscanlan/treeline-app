import { mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listDir, readFileGuarded, MAX_FILE_BYTES } from '../src/main/files-io';

describe('files-io', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'treeline-files-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe('listDir', () => {
    it('lists children dirs-first then case-insensitive by name, hiding .git', async () => {
      mkdirSync(join(dir, 'src'));
      mkdirSync(join(dir, '.git'));
      writeFileSync(join(dir, 'Zebra.ts'), '');
      writeFileSync(join(dir, 'apple.ts'), '');

      const entries = await listDir(dir);
      expect(entries.map((e) => e.name)).toEqual(['src', 'apple.ts', 'Zebra.ts']);
      expect(entries.find((e) => e.name === 'src')?.type).toBe('dir');
      expect(entries.find((e) => e.name === 'apple.ts')?.type).toBe('file');
      // .git is never surfaced.
      expect(entries.some((e) => e.name === '.git')).toBe(false);
    });

    it('returns absolute paths for entries', async () => {
      writeFileSync(join(dir, '.env'), 'X=1');
      const [entry] = await listDir(dir);
      expect(entry.path).toBe(join(dir, '.env'));
    });

    it('classifies a symlink to a directory as a dir', async () => {
      mkdirSync(join(dir, 'real'));
      symlinkSync(join(dir, 'real'), join(dir, 'link'));
      const entries = await listDir(dir);
      expect(entries.find((e) => e.name === 'link')?.type).toBe('dir');
    });
  });

  describe('readFileGuarded', () => {
    it('reads a small UTF-8 file', async () => {
      const p = join(dir, '.env');
      writeFileSync(p, 'API_KEY=secret\nPORT=3000\n');
      const res = await readFileGuarded(p);
      expect(res).toEqual({
        path: p,
        text: 'API_KEY=secret\nPORT=3000\n',
        truncated: false,
        binary: false,
      });
    });

    it('flags binary files (NUL byte) instead of returning garbage', async () => {
      const p = join(dir, 'bin');
      writeFileSync(p, Buffer.from([0x48, 0x00, 0x49]));
      const res = await readFileGuarded(p);
      expect(res.binary).toBe(true);
      expect(res.text).toBe('');
    });

    it('truncates files larger than the cap', async () => {
      const p = join(dir, 'big.txt');
      writeFileSync(p, 'a'.repeat(MAX_FILE_BYTES + 100));
      const res = await readFileGuarded(p);
      expect(res.truncated).toBe(true);
      expect(res.text.length).toBe(MAX_FILE_BYTES);
    });

    it('rejects directories', async () => {
      await expect(readFileGuarded(dir)).rejects.toThrow('not a regular file');
    });
  });
});
