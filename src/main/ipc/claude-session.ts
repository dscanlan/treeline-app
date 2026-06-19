import { ipcMain } from 'electron';
import { Channels } from '@shared/ipc-channels';
import { resolveParentRepoPath } from '../git';
import { latestSessionForCwd, copySessionToCwd } from '../claude-session';
import { validateAbsPath } from '../util/safe-path';

/**
 * IPC for resuming a Claude conversation inside a freshly-created worktree.
 *
 * Claude keys each transcript by the directory it ran in, so `claude --resume`
 * launched from a worktree can't see a session started in the repo's main
 * checkout. `prepareResume` bridges that: it resolves the worktree's parent repo
 * (the directory the agent that created the worktree was running in), finds that
 * directory's most-recent Claude session, and copies its transcript into the
 * worktree's project folder so `claude --resume <id>` finds it there. The
 * renderer then opens a terminal in the worktree and runs that command.
 *
 * Returns null when there's no parent repo or no Claude session to resume — the
 * renderer surfaces that as "nothing to resume" rather than an error.
 */
export function registerClaudeSessionIpc(): () => void {
  ipcMain.handle(Channels.ClaudeSessionPrepareResume, async (_e, rawPath: unknown) => {
    const worktreePath = validateAbsPath(rawPath);

    // The origin cwd is the worktree's parent working tree — where the agent
    // that ran `git worktree add` lives, and therefore where its session is.
    const originRepo = await resolveParentRepoPath(worktreePath);
    if (!originRepo || originRepo === worktreePath) return null;

    const session = await latestSessionForCwd(originRepo);
    if (!session) return null;

    await copySessionToCwd(session, worktreePath);
    return { sessionId: session.id, originCwd: originRepo };
  });

  // The latest session id for a cwd, no copy. Session-restore uses this to
  // re-run `claude --resume <id>` in a respawned pane that was running Claude
  // when the layout was saved — the transcript already lives in that cwd's
  // project folder, so unlike prepareResume nothing needs copying across.
  ipcMain.handle(Channels.ClaudeSessionLatestForCwd, async (_e, rawCwd: unknown) => {
    const cwd = validateAbsPath(rawCwd);
    const session = await latestSessionForCwd(cwd);
    return session?.id ?? null;
  });

  return () => {
    ipcMain.removeHandler(Channels.ClaudeSessionPrepareResume);
    ipcMain.removeHandler(Channels.ClaudeSessionLatestForCwd);
  };
}
