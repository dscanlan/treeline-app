import { readdir, open, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { DirEntry, FileContents } from '@shared/types';

/**
 * Read-only filesystem helpers for the code viewer. PTYs already grant the
 * renderer full shell access, so these don't introduce a new trust boundary;
 * the size/binary guards here are about robustness (don't freeze the renderer on
 * a huge file, don't render garbage for a binary) rather than sandboxing.
 */

// Cap a single read so a multi-megabyte log or minified bundle can't lock up the
// viewer. Files past this are returned truncated to the first MAX bytes.
export const MAX_FILE_BYTES = 1024 * 1024; // 1 MiB
// How much of the head to scan for a NUL byte when sniffing binary files.
const BINARY_SNIFF_BYTES = 8192;

/** dirs first, then case-insensitive name order — matches typical file trees. */
function compareEntries(a: DirEntry, b: DirEntry): number {
  if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
}

/** List one directory's immediate children for lazy tree expansion. */
export async function listDir(dirPath: string): Promise<DirEntry[]> {
  const dirents = await readdir(dirPath, { withFileTypes: true });
  const entries: DirEntry[] = [];
  for (const d of dirents) {
    if (d.name === '.git') continue; // never surface the git plumbing
    const full = join(dirPath, d.name);
    let type: 'file' | 'dir';
    if (d.isDirectory()) {
      type = 'dir';
    } else if (d.isSymbolicLink()) {
      // Resolve the link target so symlinked dirs still get a chevron. Skip
      // dangling links rather than showing an unopenable row.
      try {
        type = (await stat(full)).isDirectory() ? 'dir' : 'file';
      } catch {
        continue;
      }
    } else {
      type = 'file';
    }
    entries.push({ name: d.name, path: full, type });
  }
  return entries.sort(compareEntries);
}

/** Read a file's contents with size + binary guards (see FileContents). */
export async function readFileGuarded(filePath: string): Promise<FileContents> {
  const info = await stat(filePath);
  if (!info.isFile()) throw new Error('not a regular file');

  const truncated = info.size > MAX_FILE_BYTES;
  const readBytes = truncated ? MAX_FILE_BYTES : info.size;

  const fh = await open(filePath, 'r');
  try {
    const buf = Buffer.alloc(readBytes);
    const { bytesRead } = await fh.read(buf, 0, readBytes, 0);
    const data = buf.subarray(0, bytesRead);

    // Binary sniff: a NUL byte in the head is the classic "this isn't text"
    // signal. Return a placeholder instead of mojibake.
    if (data.subarray(0, BINARY_SNIFF_BYTES).includes(0)) {
      return { path: filePath, text: '', truncated: false, binary: true };
    }

    return { path: filePath, text: data.toString('utf8'), truncated, binary: false };
  } finally {
    await fh.close();
  }
}
