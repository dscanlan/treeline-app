import { describe, expect, it } from 'vitest';
import {
  AGENTS,
  AGENT_LIST,
  KIND_BY_BASENAME,
  detectAgentWorktree,
  type AgentKind,
} from '../src/shared/agents';

describe('agent registry invariants', () => {
  it('has one entry per AgentKind, keyed by its own kind', () => {
    for (const [key, def] of Object.entries(AGENTS)) {
      expect(def.kind).toBe(key);
    }
  });

  it('lists every agent exactly once in stable order', () => {
    expect(AGENT_LIST.map((a) => a.kind).sort()).toEqual(
      Object.keys(AGENTS).sort(),
    );
    const orders = AGENT_LIST.map((a) => a.order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
    expect(new Set(orders).size).toBe(orders.length);
  });

  it('has unique process basenames across agents', () => {
    const all = AGENT_LIST.flatMap((a) => a.processBasenames);
    expect(new Set(all).size).toBe(all.length);
  });

  it('derives KIND_BY_BASENAME from processBasenames', () => {
    expect(KIND_BY_BASENAME).toEqual({
      claude: 'claude',
      opencode: 'opencode',
      aider: 'aider',
    } satisfies Record<string, AgentKind>);
  });
});

// Ported from claude-detect.test.ts — the rule now lives on the registry's
// `claude` entry; detectAgentWorktree must reproduce it exactly.
describe('detectAgentWorktree', () => {
  it('claims paths under .claude/worktrees/ for claude', () => {
    expect(
      detectAgentWorktree('/Users/me/code/foo/.claude/worktrees/feat-x', 'feat-x'),
    ).toBe('claude');
  });

  it('claims branches starting with worktree- for claude', () => {
    expect(detectAgentWorktree('/tmp/wt-abc', 'worktree-abc')).toBe('claude');
  });

  it('returns null for regular branches at regular paths', () => {
    expect(detectAgentWorktree('/Users/me/code/foo', 'main')).toBeNull();
    expect(detectAgentWorktree('/Users/me/code/foo-feat', 'feat/auth')).toBeNull();
  });

  it('does not match `.claude/worktrees` only by suffix', () => {
    expect(detectAgentWorktree('/x/.claude/worktrees/y', 'whatever')).toBe('claude');
    expect(detectAgentWorktree('claude/worktrees/y', 'main')).toBeNull();
  });

  it('matches when both signals fire', () => {
    expect(detectAgentWorktree('/x/.claude/worktrees/y', 'worktree-abc')).toBe('claude');
  });
});
