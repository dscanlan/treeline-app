import { existsSync, readFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join, basename } from 'node:path';

/**
 * JSON-backed store for the single persistent scratchpad buffer
 * (`scratchpad.json`), kept separate from `config.json` (whole-config rewrite
 * per keystroke) and `session.json` (its coercers whitelist tab-shaped fields).
 * Same durability guarantees as {@link SessionStore}: atomic tmp+rename writes,
 * and a corrupt/missing file falls back to an empty buffer rather than bricking
 * startup.
 *
 * The renderer is the source of truth; it pushes the whole text via `set` (on a
 * debounce, on blur, and on window close). Everything written here is untrusted
 * (renderer-originated), so the payload is coerced to a string and capped on the
 * way in and again on load.
 */
interface PersistedScratchpad {
  version: 1;
  text: string;
}

/** Cap the buffer so a runaway paste can't bloat the file or freeze a load. */
export const MAX_SCRATCHPAD_BYTES = 1024 * 1024; // 1 MiB, matches MAX_FILE_BYTES

const EMPTY: PersistedScratchpad = { version: 1, text: '' };

export class ScratchpadStore {
  private cache: PersistedScratchpad | null = null;

  /**
   * @param scratchpadPath Absolute path to the JSON file. Tests inject a tmp
   *        path; production injects `app.getPath('userData') + '/scratchpad.json'`.
   */
  constructor(private readonly scratchpadPath: string) {}

  /** Synchronous load — runs once at startup. */
  load(): PersistedScratchpad {
    if (this.cache) return this.cache;
    if (!existsSync(this.scratchpadPath)) {
      this.cache = { ...EMPTY };
      return this.cache;
    }
    try {
      const raw = readFileSync(this.scratchpadPath, 'utf8');
      this.cache = coerceScratchpad(JSON.parse(raw));
      return this.cache;
    } catch (err) {
      console.error('scratchpad-store: failed to read, starting empty', err);
      this.cache = { ...EMPTY };
      return this.cache;
    }
  }

  /** The current buffer text. */
  getText(): string {
    return (this.cache ?? this.load()).text;
  }

  /** Replace the whole buffer and persist. Input is coerced + capped (untrusted). */
  async setText(next: unknown): Promise<void> {
    const sp = coerceScratchpad({ version: 1, text: next });
    this.cache = sp;
    await writeAtomic(this.scratchpadPath, JSON.stringify(sp, null, 2));
  }
}

/** Coerce arbitrary disk/renderer content into a valid, capped PersistedScratchpad. */
export function coerceScratchpad(raw: unknown): PersistedScratchpad {
  if (!raw || typeof raw !== 'object') return { ...EMPTY };
  const r = raw as { text?: unknown };
  const text = typeof r.text === 'string' ? r.text.slice(0, MAX_SCRATCHPAD_BYTES) : '';
  return { version: 1, text };
}

async function writeAtomic(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
  await writeFile(tmp, contents, 'utf8');
  await rename(tmp, path);
}
