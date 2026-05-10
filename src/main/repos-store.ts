import { existsSync, readFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join, basename } from 'node:path';
import type { AppConfig, Repo } from '@shared/types';

const DEFAULT_CONFIG: AppConfig = {
  repos: [],
  codeRoot: null,
  sidebarCollapsed: false,
  dismissedRepos: [],
  schemaVersion: 2,
};

/**
 * JSON-backed config store. Atomic writes via tmp+rename so a crash mid-write
 * can never leave a half-written file. Schema-versioned for future migrations.
 */
export class ReposStore {
  private cache: AppConfig | null = null;

  /**
   * @param configPath Absolute path to the JSON file. Tests inject a tmp path;
   *                   production injects `app.getPath('userData') + '/config.json'`.
   */
  constructor(private readonly configPath: string) {}

  /** Synchronous load — runs once at startup. */
  load(): AppConfig {
    if (this.cache) return this.cache;
    if (!existsSync(this.configPath)) {
      this.cache = { ...DEFAULT_CONFIG };
      return this.cache;
    }
    try {
      const raw = readFileSync(this.configPath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<AppConfig>;
      this.cache = this.migrate(parsed);
      return this.cache;
    } catch (err) {
      // Corrupt file — back it up and start fresh. We don't want a parse error
      // to brick the app's startup.
      console.error('repos-store: failed to read config, starting fresh', err);
      this.cache = { ...DEFAULT_CONFIG };
      return this.cache;
    }
  }

  /** Replace the whole config and persist. */
  async save(next: AppConfig): Promise<void> {
    this.cache = next;
    await writeAtomic(this.configPath, JSON.stringify(next, null, 2));
  }

  get(): AppConfig {
    return this.cache ?? this.load();
  }

  async addRepo(absPath: string): Promise<Repo> {
    const cfg = this.get();
    const existing = cfg.repos.find((r) => r.path === absPath);
    if (existing) return existing;

    const repo: Repo = {
      path: absPath,
      name: basename(absPath),
      addedAt: Date.now(),
    };
    await this.save({ ...cfg, repos: [...cfg.repos, repo] });
    return repo;
  }

  async removeRepo(absPath: string): Promise<void> {
    const cfg = this.get();
    if (!cfg.repos.some((r) => r.path === absPath)) return;
    await this.save({ ...cfg, repos: cfg.repos.filter((r) => r.path !== absPath) });
  }

  async setCodeRoot(p: string | null): Promise<void> {
    await this.save({ ...this.get(), codeRoot: p });
  }

  async setSidebarCollapsed(v: boolean): Promise<void> {
    await this.save({ ...this.get(), sidebarCollapsed: v });
  }

  /**
   * Mark `absPath` as a repo the user does not want to be prompted about when
   * their cwd lands inside it. No-op if it's already on the list.
   */
  async dismissRepo(absPath: string): Promise<void> {
    const cfg = this.get();
    if (cfg.dismissedRepos.includes(absPath)) return;
    await this.save({ ...cfg, dismissedRepos: [...cfg.dismissedRepos, absPath] });
  }

  /** Coerce arbitrary disk content into a current-schema AppConfig. */
  private migrate(raw: Partial<AppConfig> | null): AppConfig {
    const base: AppConfig = { ...DEFAULT_CONFIG };
    if (!raw || typeof raw !== 'object') return base;

    if (Array.isArray(raw.repos)) {
      base.repos = raw.repos
        .filter(
          (r): r is Repo =>
            !!r &&
            typeof r === 'object' &&
            typeof r.path === 'string' &&
            typeof r.name === 'string' &&
            typeof r.addedAt === 'number',
        )
        .map((r) => ({ path: r.path, name: r.name, addedAt: r.addedAt }));
    }
    if (typeof raw.codeRoot === 'string' || raw.codeRoot === null) {
      base.codeRoot = raw.codeRoot;
    }
    if (typeof raw.sidebarCollapsed === 'boolean') {
      base.sidebarCollapsed = raw.sidebarCollapsed;
    }
    if (Array.isArray(raw.dismissedRepos)) {
      base.dismissedRepos = raw.dismissedRepos.filter(
        (p): p is string => typeof p === 'string',
      );
    }
    // schemaVersion is rewritten to current on every save — no need to read it.
    return base;
  }
}

async function writeAtomic(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
  await writeFile(tmp, contents, 'utf8');
  await rename(tmp, path);
}
