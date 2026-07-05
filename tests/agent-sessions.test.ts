import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_STORES, sessionStoreFor } from '../src/main/agent-sessions';
import {
  AIDER_HISTORY_FILE,
  latestAiderSessionForCwd,
} from '../src/main/agent-sessions/aider';

describe('session-store registry (dispatcher)', () => {
  it('resolves the claude and aider stores by kind', () => {
    expect(sessionStoreFor('claude')?.kind).toBe('claude');
    expect(sessionStoreFor('aider')?.kind).toBe('aider');
  });

  it('resolves null for kinds with no store (nothing to resume, not an error)', () => {
    expect(sessionStoreFor('opencode')).toBeNull();
    expect(sessionStoreFor('codex')).toBeNull(); // not even a registered kind
    expect(sessionStoreFor('definitely-not-an-agent')).toBeNull();
  });

  it('claude can copy a session across directories (handoff); aider cannot', () => {
    expect(SESSION_STORES.claude?.copySessionToCwd).toBeTypeOf('function');
    expect(SESSION_STORES.aider?.copySessionToCwd).toBeUndefined();
  });
});

describe('aider adapter', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'treeline-aider-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('finds the cwd-keyed history file and reports the cwd as pseudo-id', async () => {
    writeFileSync(join(dir, AIDER_HISTORY_FILE), '# aider chat history\n', 'utf8');
    const session = await latestAiderSessionForCwd(dir);
    expect(session).not.toBeNull();
    expect(session!.id).toBe(dir);
    expect(session!.path).toBe(join(dir, AIDER_HISTORY_FILE));
    expect(session!.mtimeMs).toBeGreaterThan(0);
  });

  it('returns null when the cwd has no history file', async () => {
    expect(await latestAiderSessionForCwd(dir)).toBeNull();
  });

  it('returns null when the history path is a directory, not a file', async () => {
    mkdirSync(join(dir, AIDER_HISTORY_FILE));
    expect(await latestAiderSessionForCwd(dir)).toBeNull();
  });

  it('returns null for a nonexistent cwd (no crash)', async () => {
    expect(await latestAiderSessionForCwd(join(dir, 'gone'))).toBeNull();
  });
});
