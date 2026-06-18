import { describe, expect, it } from 'vitest';
import { parsePrList, rollupChecks } from '../src/main/gh';

describe('rollupChecks', () => {
  it('returns null for an empty or absent rollup', () => {
    expect(rollupChecks(undefined)).toBeNull();
    expect(rollupChecks(null)).toBeNull();
    expect(rollupChecks([])).toBeNull();
  });

  it('passes when every completed check succeeded', () => {
    expect(
      rollupChecks([
        { status: 'COMPLETED', conclusion: 'SUCCESS' },
        { status: 'COMPLETED', conclusion: 'NEUTRAL' },
        { status: 'COMPLETED', conclusion: 'SKIPPED' },
      ]),
    ).toBe('passing');
  });

  it('fails when any check concluded in failure (precedence over pending)', () => {
    expect(
      rollupChecks([
        { status: 'COMPLETED', conclusion: 'SUCCESS' },
        { status: 'IN_PROGRESS' },
        { status: 'COMPLETED', conclusion: 'FAILURE' },
      ]),
    ).toBe('failing');
    expect(rollupChecks([{ status: 'COMPLETED', conclusion: 'TIMED_OUT' }])).toBe('failing');
  });

  it('is pending when a check is in-flight and none failed', () => {
    expect(
      rollupChecks([
        { status: 'COMPLETED', conclusion: 'SUCCESS' },
        { status: 'IN_PROGRESS' },
      ]),
    ).toBe('pending');
  });

  it('handles legacy commit-status contexts reported via `state`', () => {
    expect(rollupChecks([{ state: 'SUCCESS' }])).toBe('passing');
    expect(rollupChecks([{ state: 'FAILURE' }])).toBe('failing');
    expect(rollupChecks([{ state: 'PENDING' }])).toBe('pending');
  });
});

describe('parsePrList', () => {
  it('returns {} for malformed or non-array JSON', () => {
    expect(parsePrList('not json')).toEqual({});
    expect(parsePrList('')).toEqual({});
    expect(parsePrList('{"oops":1}')).toEqual({});
  });

  it('indexes by head branch and maps state + checks', () => {
    const raw = JSON.stringify([
      {
        number: 482,
        state: 'OPEN',
        isDraft: false,
        headRefName: 'feature/pr-badges',
        url: 'https://github.com/o/r/pull/482',
        statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }],
      },
      {
        number: 471,
        state: 'OPEN',
        isDraft: true,
        headRefName: 'wip/spike',
        url: 'https://github.com/o/r/pull/471',
        statusCheckRollup: [],
      },
    ]);
    expect(parsePrList(raw)).toEqual({
      'feature/pr-badges': {
        number: 482,
        state: 'open',
        url: 'https://github.com/o/r/pull/482',
        checks: 'passing',
      },
      'wip/spike': {
        number: 471,
        state: 'draft',
        url: 'https://github.com/o/r/pull/471',
        checks: null,
      },
    });
  });

  it('maps MERGED and CLOSED terminal states', () => {
    const raw = JSON.stringify([
      { number: 1, state: 'MERGED', isDraft: false, headRefName: 'a', url: 'u1' },
      { number: 2, state: 'CLOSED', isDraft: false, headRefName: 'b', url: 'u2' },
    ]);
    const out = parsePrList(raw);
    expect(out['a']?.state).toBe('merged');
    expect(out['b']?.state).toBe('closed');
  });

  it('keeps the first (newest) PR when two share a head branch', () => {
    const raw = JSON.stringify([
      { number: 9, state: 'OPEN', isDraft: false, headRefName: 'dup', url: 'new' },
      { number: 3, state: 'CLOSED', isDraft: false, headRefName: 'dup', url: 'old' },
    ]);
    expect(parsePrList(raw)['dup']).toMatchObject({ number: 9, state: 'open' });
  });

  it('skips entries missing a branch or number', () => {
    const raw = JSON.stringify([
      { number: 5, state: 'OPEN', isDraft: false, url: 'u' },
      { state: 'OPEN', isDraft: false, headRefName: 'x', url: 'u' },
    ]);
    expect(parsePrList(raw)).toEqual({});
  });
});
