import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ScratchpadStore,
  coerceScratchpad,
  MAX_SCRATCHPAD_BYTES,
} from '../src/main/scratchpad-store';

describe('ScratchpadStore', () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'treeline-scratchpad-'));
    path = join(dir, 'scratchpad.json');
  });

  afterEach(() => {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it('load() returns an empty buffer when the file is missing', () => {
    const store = new ScratchpadStore(path);
    store.load();
    expect(store.getText()).toBe('');
  });

  it('setText() then a fresh load() round-trips through disk atomically', async () => {
    const a = new ScratchpadStore(path);
    a.load();
    await a.setText('hello\nworld');

    const b = new ScratchpadStore(path);
    b.load();
    expect(b.getText()).toBe('hello\nworld');
    // Persisted shape carries a version for forward-compat.
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
      version: 1,
      text: 'hello\nworld',
    });
  });

  it('a corrupt file falls back to an empty buffer rather than throwing', () => {
    writeFileSync(path, '{ not valid json', 'utf8');
    const store = new ScratchpadStore(path);
    expect(() => store.load()).not.toThrow();
    expect(store.getText()).toBe('');
  });

  it('coerces a non-string payload to an empty buffer', async () => {
    const store = new ScratchpadStore(path);
    store.load();
    await store.setText(42 as unknown);
    expect(store.getText()).toBe('');
  });
});

describe('coerceScratchpad', () => {
  it('drops non-object input to an empty buffer', () => {
    expect(coerceScratchpad(null)).toEqual({ version: 1, text: '' });
    expect(coerceScratchpad(42)).toEqual({ version: 1, text: '' });
  });

  it('drops a non-string text field', () => {
    expect(coerceScratchpad({ version: 1, text: 99 })).toEqual({ version: 1, text: '' });
  });

  it('caps the text at MAX_SCRATCHPAD_BYTES', () => {
    const huge = 'x'.repeat(MAX_SCRATCHPAD_BYTES + 100);
    expect(coerceScratchpad({ version: 1, text: huge }).text.length).toBe(
      MAX_SCRATCHPAD_BYTES,
    );
  });
});
