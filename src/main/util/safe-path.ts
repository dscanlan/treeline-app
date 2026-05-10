import { isAbsolute, normalize } from 'node:path';

/**
 * Validate a path that came from the renderer over IPC.
 * Reject relative paths, paths with NUL bytes, and obvious traversal attempts.
 * Returns the normalized absolute path.
 */
export function validateAbsPath(p: unknown): string {
  if (typeof p !== 'string') throw new Error('path must be a string');
  if (p.length === 0) throw new Error('path must not be empty');
  if (p.includes('\0')) throw new Error('path contains NUL byte');
  if (!isAbsolute(p)) throw new Error('path must be absolute');
  return normalize(p);
}

/** Branch names allowed by createWorktree. Rejects leading `-` (would be a flag). */
export function validateBranchName(branch: unknown): string {
  if (typeof branch !== 'string') throw new Error('branch must be a string');
  if (branch.length === 0) throw new Error('branch must not be empty');
  if (branch.startsWith('-')) throw new Error('branch must not start with "-"');
  if (!/^[A-Za-z0-9._\-/]+$/.test(branch)) {
    throw new Error('branch contains invalid characters');
  }
  return branch;
}

/**
 * Validate a directory name (a single path segment, NOT a full path). Used
 * when the user types the folder name for a new repo into CreateRepoModal —
 * we then join it with a separately-validated parent dir. Rejecting separators
 * here prevents the user from sneaking in `../escape` or `sub/dir` shenanigans
 * via the name field.
 */
export function validateFolderName(name: unknown): string {
  if (typeof name !== 'string') throw new Error('folder name must be a string');
  const trimmed = name.trim();
  if (trimmed.length === 0) throw new Error('folder name must not be empty');
  if (trimmed.includes('\0')) throw new Error('folder name contains NUL byte');
  if (trimmed.includes('/') || trimmed.includes('\\')) {
    throw new Error('folder name must not contain path separators');
  }
  if (trimmed === '.' || trimmed === '..') {
    throw new Error('folder name must not be "." or ".."');
  }
  return trimmed;
}
