import { existsSync, readFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join, basename } from 'node:path';
import type {
  PersistedNode,
  PersistedSession,
  PersistedTab,
} from '@shared/types';

/**
 * JSON-backed store for the persisted tab layout (`session.json`), kept separate
 * from `config.json` because it's high-churn (every tab add/split/resize) and
 * structurally unrelated to repos/settings. Same durability guarantees as
 * {@link ReposStore}: atomic tmp+rename writes, and a corrupt/missing file falls
 * back to an empty session rather than bricking startup.
 *
 * The renderer is the source of truth for tab state; it pushes whole snapshots
 * via `set`. Everything written here is untrusted (renderer-originated), so
 * `coerceSession` validates the tree shape on the way in and again on load.
 */
const EMPTY_SESSION: PersistedSession = { version: 1, tabs: [], activeTabId: null };

export class SessionStore {
  private cache: PersistedSession | null = null;

  /**
   * @param sessionPath Absolute path to the JSON file. Tests inject a tmp path;
   *                    production injects `app.getPath('userData') + '/session.json'`.
   */
  constructor(private readonly sessionPath: string) {}

  /** Synchronous load — runs once at startup. */
  load(): PersistedSession {
    if (this.cache) return this.cache;
    if (!existsSync(this.sessionPath)) {
      this.cache = { ...EMPTY_SESSION };
      return this.cache;
    }
    try {
      const raw = readFileSync(this.sessionPath, 'utf8');
      this.cache = coerceSession(JSON.parse(raw));
      return this.cache;
    } catch (err) {
      console.error('session-store: failed to read session, starting empty', err);
      this.cache = { ...EMPTY_SESSION };
      return this.cache;
    }
  }

  get(): PersistedSession {
    return this.cache ?? this.load();
  }

  /** Replace the whole session and persist. Input is coerced (untrusted). */
  async set(next: unknown): Promise<void> {
    const session = coerceSession(next);
    this.cache = session;
    await writeAtomic(this.sessionPath, JSON.stringify(session, null, 2));
  }
}

/** Coerce arbitrary disk/renderer content into a valid PersistedSession. */
export function coerceSession(raw: unknown): PersistedSession {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_SESSION };
  const r = raw as Partial<PersistedSession>;
  const tabs = Array.isArray(r.tabs)
    ? r.tabs.map(coerceTab).filter((t): t is PersistedTab => t !== null)
    : [];
  const activeTabId = typeof r.activeTabId === 'string' ? r.activeTabId : null;
  // Keep activeTabId only if it still points at a surviving tab.
  const active = tabs.some((t) => t.id === activeTabId) ? activeTabId : null;
  return { version: 1, tabs, activeTabId: active };
}

function coerceTab(raw: unknown): PersistedTab | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as Partial<PersistedTab>;
  if (typeof t.id !== 'string' || typeof t.cwd !== 'string') return null;
  const root = coerceNode(t.root);
  if (!root) return null;
  return {
    id: t.id,
    cwd: t.cwd,
    title: typeof t.title === 'string' ? t.title : '',
    root,
    focusedPaneId: typeof t.focusedPaneId === 'string' ? t.focusedPaneId : '',
    ...(t.scratch === true ? { scratch: true } : {}),
  };
}

function coerceNode(raw: unknown): PersistedNode | null {
  if (!raw || typeof raw !== 'object') return null;
  const n = raw as Record<string, unknown>;
  if (n.kind === 'leaf') {
    if (typeof n.id !== 'string' || typeof n.cwd !== 'string') return null;
    return {
      kind: 'leaf',
      id: n.id,
      cwd: n.cwd,
      title: typeof n.title === 'string' ? n.title : '',
      claudePane: n.claudePane === true,
      ...(typeof n.claudeSessionId === 'string'
        ? { claudeSessionId: n.claudeSessionId }
        : {}),
    };
  }
  if (n.kind === 'split') {
    if (typeof n.id !== 'string') return null;
    if (n.direction !== 'h' && n.direction !== 'v') return null;
    if (!Array.isArray(n.children)) return null;
    const children = n.children
      .map(coerceNode)
      .filter((c): c is PersistedNode => c !== null);
    // A split needs ≥2 children to be meaningful; a degenerate one collapses to
    // its sole child (or drops entirely), mirroring removePane's collapse rule.
    if (children.length === 0) return null;
    if (children.length === 1) return children[0];
    const sizes =
      Array.isArray(n.sizes) && n.sizes.length === children.length
        ? n.sizes.map((s) => (typeof s === 'number' && Number.isFinite(s) ? s : 1 / children.length))
        : children.map(() => 1 / children.length);
    return { kind: 'split', id: n.id, direction: n.direction, children, sizes };
  }
  return null;
}

async function writeAtomic(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
  await writeFile(tmp, contents, 'utf8');
  await rename(tmp, path);
}
