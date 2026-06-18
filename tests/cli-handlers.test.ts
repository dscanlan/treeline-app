import { describe, expect, it, vi } from 'vitest';
import { buildCliHandlers, resolveWorktree, type CliDeps } from '../src/main/cli-handlers';
import type { Repo, Worktree } from '../src/shared/types';

function repo(name: string, path: string): Repo {
  return { name, path, addedAt: 0 };
}

function wt(path: string, branch: string, extra: Partial<Worktree> = {}): Worktree {
  return {
    path,
    branch,
    commit: 'abc1234',
    isBare: false,
    isDirty: false,
    isCurrent: false,
    isClaude: false,
    ...extra,
  };
}

function makeDeps(over: Partial<CliDeps> = {}): CliDeps {
  return {
    version: '9.9.9',
    listRepos: () => [repo('app', '/code/app')],
    listWorktrees: async () => [
      wt('/code/app', 'main'),
      wt('/code/app/.claude/worktrees/feat', 'worktree-feat', { isClaude: true }),
    ],
    notify: vi.fn(),
    openWorktree: vi.fn(),
    sendKeys: vi.fn(),
    browserNavigate: vi.fn(async () => {}),
    browserEval: vi.fn(async () => 'page title'),
    browserScreenshot: vi.fn(async () => 'data:image/png;base64,AAAA'),
    browserScreenshotToFile: vi.fn(async (p: string) => p),
    ...over,
  };
}

describe('resolveWorktree', () => {
  it('resolves repo name + branch to that worktree path', async () => {
    const path = await resolveWorktree(makeDeps(), { repo: 'app', branch: 'worktree-feat' });
    expect(path).toBe('/code/app/.claude/worktrees/feat');
  });

  it('matches a repo by absolute path too', async () => {
    const path = await resolveWorktree(makeDeps(), { repo: '/code/app', branch: 'main' });
    expect(path).toBe('/code/app');
  });

  it('falls back to the primary (non-bare) worktree when no branch is given', async () => {
    const deps = makeDeps({
      listWorktrees: async () => [
        wt('/code/app/bare', '(bare)', { isBare: true }),
        wt('/code/app', 'main'),
      ],
    });
    expect(await resolveWorktree(deps, { repo: 'app' })).toBe('/code/app');
  });

  it('honours an exact worktree path passed as the repo selector', async () => {
    const path = await resolveWorktree(makeDeps(), {
      repo: '/code/app/.claude/worktrees/feat',
    });
    expect(path).toBe('/code/app/.claude/worktrees/feat');
  });

  it('throws for an unknown repo', async () => {
    await expect(resolveWorktree(makeDeps(), { repo: 'nope' })).rejects.toThrow(/unknown repo/);
  });

  it('throws when the branch has no matching worktree', async () => {
    await expect(
      resolveWorktree(makeDeps(), { repo: 'app', branch: 'ghost' }),
    ).rejects.toThrow(/no worktree on branch "ghost"/);
  });
});

describe('buildCliHandlers', () => {
  it('ping reports the app version', async () => {
    const h = buildCliHandlers(makeDeps());
    expect(await h.ping({})).toEqual({ ok: true, app: 'treeline', version: '9.9.9' });
  });

  it('repos returns the tracked repo list', async () => {
    const h = buildCliHandlers(makeDeps());
    expect(await h.repos({})).toEqual([repo('app', '/code/app')]);
  });

  it('worktrees requires a repo and rejects unknown ones', async () => {
    const h = buildCliHandlers(makeDeps());
    await expect(h.worktrees({})).rejects.toThrow(/missing required argument: repo/);
    await expect(h.worktrees({ repo: 'ghost' })).rejects.toThrow(/unknown repo/);
    expect(await h.worktrees({ repo: 'app' })).toHaveLength(2);
  });

  it('notify forwards the text to the notify dep', async () => {
    const notify = vi.fn();
    const h = buildCliHandlers(makeDeps({ notify }));
    await h.notify({ text: 'build done' });
    expect(notify).toHaveBeenCalledWith('build done');
  });

  it('notify rejects empty text', () => {
    const h = buildCliHandlers(makeDeps());
    expect(() => h.notify({})).toThrow(/missing required argument: text/);
  });

  it('open resolves the worktree then drives openWorktree', async () => {
    const openWorktree = vi.fn();
    const h = buildCliHandlers(makeDeps({ openWorktree }));
    const res = await h.open({ repo: 'app', branch: 'worktree-feat' });
    expect(openWorktree).toHaveBeenCalledWith('/code/app/.claude/worktrees/feat');
    expect(res).toEqual({ opened: '/code/app/.claude/worktrees/feat' });
  });

  it('send forwards text to sendKeys (empty string allowed, wrong type rejected)', () => {
    const sendKeys = vi.fn();
    const h = buildCliHandlers(makeDeps({ sendKeys }));
    expect(h.send({ text: 'npm test\n' })).toEqual({ sent: 9 });
    expect(sendKeys).toHaveBeenCalledWith('npm test\n');
    expect(h.send({ text: '' })).toEqual({ sent: 0 });
    expect(() => h.send({})).toThrow(/missing required argument: text/);
  });

  it('browser navigate normalizes the URL then drives browserNavigate', async () => {
    const browserNavigate = vi.fn();
    const h = buildCliHandlers(makeDeps({ browserNavigate }));
    // Scheme-less input is assumed http:// by normalizeBrowserUrl.
    const res = await h.browser({ action: 'navigate', url: 'localhost:3000' });
    expect(browserNavigate).toHaveBeenCalledWith('http://localhost:3000', false);
    expect(res).toEqual({ navigated: 'http://localhost:3000' });
  });

  it('browser navigate --wait passes the wait flag through', async () => {
    const browserNavigate = vi.fn(async () => {});
    const h = buildCliHandlers(makeDeps({ browserNavigate }));
    await h.browser({ action: 'navigate', url: 'localhost:3000', wait: true });
    expect(browserNavigate).toHaveBeenCalledWith('http://localhost:3000', true);
  });

  it('browser navigate rejects a non-web URL', async () => {
    const h = buildCliHandlers(makeDeps());
    await expect(h.browser({ action: 'navigate', url: 'file:///etc/passwd' })).rejects.toThrow(
      /not a navigable/,
    );
  });

  it('browser eval returns the evaluated result', async () => {
    const browserEval = vi.fn(async () => 42);
    const h = buildCliHandlers(makeDeps({ browserEval }));
    expect(await h.browser({ action: 'eval', code: '6*7' })).toEqual({ result: 42 });
    expect(browserEval).toHaveBeenCalledWith('6*7');
  });

  it('browser eval requires the code argument', async () => {
    const h = buildCliHandlers(makeDeps());
    await expect(h.browser({ action: 'eval' })).rejects.toThrow(/missing required argument: code/);
  });

  it('browser screenshot returns the captured data URL', async () => {
    const h = buildCliHandlers(makeDeps());
    expect(await h.browser({ action: 'screenshot' })).toEqual({
      screenshot: 'data:image/png;base64,AAAA',
    });
  });

  it('browser screenshot writes to a file when a path is given', async () => {
    const browserScreenshotToFile = vi.fn(async (p: string) => p);
    const h = buildCliHandlers(makeDeps({ browserScreenshotToFile }));
    expect(await h.browser({ action: 'screenshot', path: '/tmp/shot.png' })).toEqual({
      saved: '/tmp/shot.png',
    });
    expect(browserScreenshotToFile).toHaveBeenCalledWith('/tmp/shot.png');
  });

  it('browser rejects an unknown action', async () => {
    const h = buildCliHandlers(makeDeps());
    await expect(h.browser({ action: 'teleport' })).rejects.toThrow(/unknown browser action/);
  });
});
