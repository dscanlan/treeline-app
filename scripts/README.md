# Scripts

Test fixtures and launcher helpers for treeline-app, mirroring the workflow in
`/Users/dominicscanlan/code/treeline/scripts/` (the Rust TUI).

## Quick start

```bash
./scripts/launch-with-test-scenario.sh
```

This single command:

1. Creates `./.test-code-root/` with three pretend projects (`api`, `frontend`,
   `cli-tool`), each containing a main checkout plus several worktrees,
   including a dirty one and two Claude-style ones.
2. Backs up your existing `~/Library/Application Support/treeline-app/config.json`.
3. Writes a fresh config that pre-adds the three fixture repos.
4. Runs `npm run dev` to launch the app.
5. On exit, restores your config and removes the fixture directory.

## `setup-test-scenarios.sh`

Creates the fixture *only* — no app launch, no config changes. Useful when you
want to point a packaged build at the fixture manually.

```bash
./scripts/setup-test-scenarios.sh                  # → ./.test-code-root/
./scripts/setup-test-scenarios.sh /tmp/treeline-fx # → /tmp/treeline-fx/
```

### What it creates

Per project (3 projects total):

| Worktree path                              | Branch                        | State              |
| ------------------------------------------ | ----------------------------- | ------------------ |
| `<project>` (the main checkout)            | `main`                        | clean              |
| `<project>/auth-worktree`                  | `feature/auth`                | clean              |
| `<project>/api-v2-worktree`                | `feature/api-v2`              | clean              |
| `<project>/bug-fix-worktree`               | `fix/bug-123`                 | **dirty**          |
| `<project>/.claude/worktrees/claude-branch-1` | `worktree-claude-branch-1` | Claude-style       |
| `<project>/.claude/worktrees/claude-branch-2` | `worktree-claude-branch-2` | Claude-style       |

The Claude-style worktrees exercise the magenta `✦ Claude` subgroup in the
sidebar.

## `launch-with-test-scenario.sh`

Wraps `setup-test-scenarios.sh`, swaps in a pre-loaded config, runs `npm run dev`,
and cleans everything up on exit. Use this for screenshots or live demos.

## Cleanup

Both scripts are idempotent. The fixture marker file
`.treeline-test-scenario` lets the launcher know the directory is disposable;
it will refuse to remove a directory that doesn't have it.
