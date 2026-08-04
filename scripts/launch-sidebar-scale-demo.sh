#!/bin/bash

# Launch an isolated development instance with 30 real repositories, multiple
# worktrees, three plain folders, and six open terminals. The normal Treeline
# config and running instance are untouched because this uses a fresh userData
# directory and CLI socket on every run.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DEMO_ROOT="${1:-/private/tmp/treeline-sidebar-scale-demo}"
REPOS_ROOT="$DEMO_ROOT/repos"
WORKTREES_ROOT="$DEMO_ROOT/worktrees"
FOLDERS_ROOT="$DEMO_ROOT/folders"
USER_DATA="$DEMO_ROOT/user-data-$$"
SOCK="$USER_DATA/cli.sock"

REPOS=(
  accounts-api audit-service auth-gateway billing-worker catalog-api
  checkout-web customer-data design-system developer-portal event-router
  feature-flags fulfilment-api identity-service inventory-worker mobile-app
  notifications-api observability orders-service payments-api pricing-engine
  reporting-web risk-service search-api shipping-worker support-tools
  tax-service treeline-app web-storefront workflow-engine workspace-tools
)

mkdir -p "$REPOS_ROOT" "$WORKTREES_ROOT" "$FOLDERS_ROOT" "$USER_DATA"
mkdir -p "$FOLDERS_ROOT/design-notes" "$FOLDERS_ROOT/incident-runbooks" "$FOLDERS_ROOT/team-docs"

echo "Preparing 30-repository sidebar fixture in $DEMO_ROOT"

for index in "${!REPOS[@]}"; do
  name="${REPOS[$index]}"
  if [ "$index" -lt 10 ]; then area="platform"; elif [ "$index" -lt 20 ]; then area="products"; else area="labs"; fi
  repo="$REPOS_ROOT/$area/$name"
  mkdir -p "$repo"

  if [ ! -d "$repo/.git" ]; then
    git -C "$repo" init -q -b main
    printf '# %s\n\nScale-demo repository %s.\n' "$name" "$((index + 1))" > "$repo/README.md"
    git -C "$repo" add README.md
    git -C "$repo" -c user.name='Treeline Demo' -c user.email='demo@treeline.local' commit -qm 'Initial demo commit'
  fi

  if (( index % 3 == 0 )); then
    branch="feat/demo-$((index + 1))"
    path="$WORKTREES_ROOT/$name/feature-$((index + 1))"
    if [ ! -e "$path/.git" ]; then
      mkdir -p "$(dirname "$path")"
      git -C "$repo" worktree add -q -b "$branch" "$path" 2>/dev/null ||
        git -C "$repo" worktree add -q "$path" "$branch"
    fi
  fi

  if (( index % 5 == 0 )); then
    branch="worktree-agent-$((index + 1))"
    path="$WORKTREES_ROOT/$name/agent-$((index + 1))"
    if [ ! -e "$path/.git" ]; then
      mkdir -p "$(dirname "$path")"
      git -C "$repo" worktree add -q -b "$branch" "$path" 2>/dev/null ||
        git -C "$repo" worktree add -q "$path" "$branch"
    fi
  fi
done

# Seed a few status signals that are easy to spot in Library and Working.
if ! grep -q 'Local demo change' "$WORKTREES_ROOT/billing-worker/feature-4/README.md"; then
  printf '\nLocal demo change.\n' >> "$WORKTREES_ROOT/billing-worker/feature-4/README.md"
fi
if ! grep -q 'Local demo change' "$REPOS_ROOT/labs/search-api/README.md"; then
  printf '\nLocal demo change.\n' >> "$REPOS_ROOT/labs/search-api/README.md"
fi

node - "$USER_DATA/config.json" "$REPOS_ROOT" "$FOLDERS_ROOT" "${REPOS[@]}" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const [configPath, reposRoot, foldersRoot, ...names] = process.argv.slice(2);
const repos = names.map((name, index) => {
  const area = index < 10 ? 'platform' : index < 20 ? 'products' : 'labs';
  return { path: path.join(reposRoot, area, name), name, addedAt: Date.now() + index };
});
const folders = ['design-notes', 'incident-runbooks', 'team-docs'].map((name, index) => ({
  path: path.join(foldersRoot, name),
  name,
  addedAt: Date.now() + index,
}));
fs.writeFileSync(configPath, JSON.stringify({
  repos,
  folders,
  codeRoot: reposRoot,
  sidebarCollapsed: false,
  dismissedRepos: [],
  settings: {
    terminalTheme: 'graphite',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    fontSize: 13,
    keybindings: {},
    vaultPath: null,
  },
  schemaVersion: 4,
}, null, 2));
NODE

echo "Starting isolated Treeline development instance"
echo "  Repositories: 30"
echo "  Fixture:      $DEMO_ROOT"
echo "  User data:    $USER_DATA"

cd "$PROJECT_ROOT"
TREELINE_USER_DATA="$USER_DATA" TREELINE_SOCK="$SOCK" npm run dev &
APP_PID=$!

cleanup() {
  kill "$APP_PID" 2>/dev/null || true
}
trap cleanup INT TERM

for _ in $(seq 1 80); do
  if [ -S "$SOCK" ]; then break; fi
  sleep 0.25
done

if [ -S "$SOCK" ]; then
  sleep 2
  TREELINE_SOCK="$SOCK" node bin/treeline.mjs open accounts-api feat/demo-1 >/dev/null
  TREELINE_SOCK="$SOCK" node bin/treeline.mjs open billing-worker feat/demo-4 >/dev/null
  TREELINE_SOCK="$SOCK" node bin/treeline.mjs open catalog-api >/dev/null
  TREELINE_SOCK="$SOCK" node bin/treeline.mjs open identity-service feat/demo-13 >/dev/null
  TREELINE_SOCK="$SOCK" node bin/treeline.mjs open search-api >/dev/null
  TREELINE_SOCK="$SOCK" node bin/treeline.mjs open treeline-app >/dev/null
  echo "Opened six worktrees; Working should now show six targets and Library 30 repos."
else
  echo "Treeline CLI socket did not appear; the catalog is populated but terminals were not opened." >&2
fi

wait "$APP_PID"
