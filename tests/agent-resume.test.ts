import { describe, expect, it } from 'vitest';
import {
  AGENTS,
  buildRestoreCommand,
  buildRestoreCommandFor,
} from '../src/shared/agents';

// The exact strings written to a pty on restore, per kind. These are typed
// into a live shell — treat any change as behaviour, not cosmetics.
describe('buildRestoreCommand', () => {
  it('claude resumes by id', () => {
    expect(buildRestoreCommand('claude', 'abc-123')).toBe('claude --resume abc-123');
  });

  it('opencode resumes by session id', () => {
    expect(buildRestoreCommand('opencode', 'ses_9x')).toBe('opencode --session ses_9x');
  });

  it('aider resumes id-less from its cwd-keyed history', () => {
    expect(buildRestoreCommand('aider', null)).toBe('aider --restore-chat-history');
    // Even when a (nonsense) id is present, aider has no id-based restore —
    // the id must never be interpolated.
    expect(buildRestoreCommand('aider', 'some-id')).toBe('aider --restore-chat-history');
  });

  it('claude/opencode without an id resume nothing (plain shell)', () => {
    expect(buildRestoreCommand('claude', null)).toBeNull();
    expect(buildRestoreCommand('claude', undefined)).toBeNull();
    expect(buildRestoreCommand('opencode', null)).toBeNull();
  });

  it('a kind with no resume capability restores nothing', () => {
    expect(buildRestoreCommandFor(null, 'abc')).toBeNull();
  });
});

// Injection guard: ids are typed into a shell, so anything a shell could
// interpret must be rejected — the malicious id may never appear in output.
describe('session id injection guard', () => {
  const hostile = [
    'x; touch /tmp/pwned',
    'x && rm -rf ~',
    '$(reboot)',
    '`reboot`',
    'a b',
    "x'y",
    'x"y',
    'x|y',
    'x\ny',
    '',
    'a'.repeat(129), // over the 128-char cap
  ];

  it.each(hostile)('claude never interpolates %j', (id) => {
    const cmd = buildRestoreCommand('claude', id);
    expect(cmd).toBeNull();
  });

  it.each(hostile)('opencode never interpolates %j', (id) => {
    expect(buildRestoreCommand('opencode', id)).toBeNull();
  });

  it.each(hostile)('the claude fork builder is guarded by the same validator (%j)', (id) => {
    const cap = AGENTS.claude.resume!;
    // The fork call-site (worktree handoff) checks isValidSessionId before
    // calling fork() — assert the validator itself rejects.
    expect(cap.isValidSessionId(id)).toBe(false);
  });

  it('accepts filename-shaped ids (UUIDs, ses_… ids)', () => {
    const cap = AGENTS.claude.resume!;
    expect(cap.isValidSessionId('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    expect(AGENTS.opencode.resume!.isValidSessionId('ses_4Xq9zK')).toBe(true);
  });
});

describe('fork builders (worktree handoff)', () => {
  it('claude forks with --fork-session', () => {
    expect(AGENTS.claude.resume!.fork!('abc')).toBe('claude --resume abc --fork-session');
  });

  it('opencode forks with --fork', () => {
    expect(AGENTS.opencode.resume!.fork!('ses_1')).toBe('opencode --session ses_1 --fork');
  });

  it('aider has no fork (no handoff offer)', () => {
    expect(AGENTS.aider.resume!.fork).toBeUndefined();
  });
});
