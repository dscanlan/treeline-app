#!/bin/bash

# Launches treeline-app with a fresh test scenario preloaded.
#
# Backs up the existing config, writes a new one with the fixture repos
# already added, runs `npm run dev`, and on exit restores the original config
# and removes the fixture directory.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
TEST_ROOT_INPUT="${1:-$PROJECT_ROOT/.test-code-root}"
TEST_ROOT="$(mkdir -p "$TEST_ROOT_INPUT" && cd "$TEST_ROOT_INPUT" && pwd)"
SCENARIO_MARKER=".treeline-test-scenario"

# Electron uses `app.getPath('userData')` which on macOS is:
#   ~/Library/Application Support/<productName>
# We set productName to "treeline-app" in electron-builder.yml, but the dev
# build (electron-vite) inherits from package.json `name`, which is also
# `treeline-app` here. Both resolve to the same dir.
CONFIG_DIR="$HOME/Library/Application Support/treeline-app"
CONFIG_FILE="$CONFIG_DIR/config.json"
CONFIG_BACKUP=""

restore_config() {
  echo ""
  if [ -n "$CONFIG_BACKUP" ] && [ -f "$CONFIG_BACKUP" ]; then
    mv "$CONFIG_BACKUP" "$CONFIG_FILE"
    echo "✓ Original config restored"
  else
    rm -f "$CONFIG_FILE"
    echo "✓ Test config cleaned up"
  fi

  if [ -f "$TEST_ROOT/$SCENARIO_MARKER" ]; then
    cd /
    rm -rf "$TEST_ROOT"
    echo "✓ Test fixture removed: $TEST_ROOT"
  fi
}

trap restore_config EXIT

echo "🎬 Setting up test scenario..."
"$SCRIPT_DIR/setup-test-scenarios.sh" "$TEST_ROOT"

# Back up existing config so the launcher leaves the user's state untouched.
mkdir -p "$CONFIG_DIR"
if [ -f "$CONFIG_FILE" ]; then
  CONFIG_BACKUP="${CONFIG_FILE}.backup-$(date +%s)"
  cp "$CONFIG_FILE" "$CONFIG_BACKUP"
  echo "📝 Backed up existing config to: $CONFIG_BACKUP"
fi

# Write a config that pre-adds every fixture project so the user doesn't have
# to click "+ Add repo" three times.
NOW_MS=$(($(date +%s) * 1000))
{
  echo '{'
  echo '  "schemaVersion": 1,'
  echo '  "codeRoot": null,'
  echo '  "sidebarCollapsed": false,'
  echo '  "repos": ['
  first=1
  for project in api frontend cli-tool; do
    if [ $first -eq 1 ]; then first=0; else echo '    ,'; fi
    cat <<EOF
    {
      "path": "$TEST_ROOT/$project",
      "name": "$project",
      "addedAt": $NOW_MS
    }
EOF
  done
  echo '  ]'
  echo '}'
} > "$CONFIG_FILE"
echo "✅ Pre-loaded config with fixture repos"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📸 Launching treeline-app dev build..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Test root: $TEST_ROOT"
echo "  Quit the app to clean up automatically."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

cd "$PROJECT_ROOT"
npm run dev
