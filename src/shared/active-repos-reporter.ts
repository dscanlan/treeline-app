/**
 * De-duplicating reporter for the renderer → main "active repos" signal (see
 * `activeRepoPaths` in `sidebar-model` and `WorktreeWatcher.setActiveRepos`).
 *
 * Main treats "never reported" as "everything is active" (the safe,
 * pre-throttle behaviour), so the very first report must go out even when it
 * is empty — an idle sidebar with no tabs is exactly the case the throttle
 * exists for. After that, only a changed set is re-sent.
 */
export function createActiveReposReporter(
  send: (repoPaths: string[]) => void,
): (repoPaths: string[]) => void {
  let last: string | null = null;
  return (repoPaths) => {
    const key = repoPaths.join('\n');
    if (key === last) return;
    last = key;
    send(repoPaths);
  };
}
