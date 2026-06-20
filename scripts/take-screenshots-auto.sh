#!/bin/bash

# Automated companion to scripts/take-screenshots.sh. Builds the app, then
# loops through scenario IDs handled by src/main/screenshot.ts. Each run
# launches Electron with TREELINE_SCREENSHOT_ID=<id>; the main process sets
# up the named scenario, captures the renderer via webContents.capturePage(),
# writes the PNG to docs/img/, and exits.
#
# Trade-off (see the AskUserQuestion design discussion): capturePage()
# returns the renderer bitmap only — no traffic lights, no rounded corners,
# no shadow. For chrome-critical README hero shots, keep using the
# interactive scripts/take-screenshots.sh.
#
# Run with:
#   ./scripts/take-screenshots-auto.sh                # all scenarios
#   ./scripts/take-screenshots-auto.sh 16-discovery-toast   # one scenario

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

ALL_SCENARIOS=(
  "01-empty"
  "02-sidebar"
  "03-terminal"
  "04-create-modal"
  "05-delete-modal"
  "06-collapsed"
  "07-multi-tabs"
  "08-filter"
  "09-hover-repo-actions"
  "10-hover-worktree-delete"
  "11-claude-tab-running"
  "12-claude-group-expanded"
  "13-dirty-marker"
  "14-status-dots"
  "15-sidebar-collapse-btn"
  "16-discovery-toast"
  "17-add-after-discovery"
  "18-add-button-tooltip"
  "19-scratch-terminals"
  "20-create-repo-modal"
  "21-code-viewer-diff"
  "22-file-editing"
  "23-discard-modal"
  "24-markdown-preview"
  "25-split-right"
  "26-split-grid"
  "27-browser"
  "28-settings-modal"
  "29-settings-keybind-conflict"
  "30-theme-light"
  "31-theme-midnight"
  "32-listening-ports"
  "33-open-folder"
  "34-pr-status"
  "35-worktree-open-toast"
  "36-agent-notifications"
  "37-session-paused"
  "38-reattach-toast"
  "39-restore-prompt"
  "40-scratch-restored"
)

if [ $# -gt 0 ]; then
  SCENARIOS=("$@")
else
  SCENARIOS=("${ALL_SCENARIOS[@]}")
fi

# Build into out/. Keep this verbose enough that a build failure is
# obvious without having to scroll the loop output.
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Building treeline-app for screenshot mode"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
npm run build

ELECTRON_BIN="$PROJECT_ROOT/node_modules/.bin/electron"
if [ ! -x "$ELECTRON_BIN" ]; then
  echo "✗ Could not find Electron binary at $ELECTRON_BIN" >&2
  echo "  Run \`npm install\` and try again." >&2
  exit 1
fi

OUT_DIR="$PROJECT_ROOT/docs/img"
mkdir -p "$OUT_DIR"

failed=()
for id in "${SCENARIOS[@]}"; do
  echo ""
  echo "📸 $id"
  out="$OUT_DIR/$id.png"
  rm -f "$out"

  # `--no-sandbox` and `--disable-gpu` avoid macOS GPU init churn that we
  # don't need for a one-shot capture; we use software rendering via
  # capturePage() anyway. The renderer-ready signal in screenshot.ts has
  # its own 5s timeout, and runScreenshot now always calls app.exit, so
  # an unmatched hover selector fails fast instead of hanging the loop.
  # We don't bail on individual failures — the whole point of running the
  # script is to refresh all PNGs, and skipping one shouldn't strand the
  # rest. Failures are collected and reported at the end.
  if ! TREELINE_SCREENSHOT_ID="$id" \
      "$ELECTRON_BIN" "$PROJECT_ROOT/out/main/index.js" --no-sandbox --disable-gpu; then
    echo "  ✗ scenario $id exited non-zero" >&2
    failed+=("$id")
    continue
  fi

  if [ ! -s "$out" ]; then
    echo "  ✗ no PNG was written for $id" >&2
    failed+=("$id")
    continue
  fi
  echo "  ✓ $out ($(wc -c <"$out" | tr -d ' ') bytes)"
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ ${#failed[@]} -eq 0 ]; then
  echo "✨ Auto captures complete"
else
  echo "⚠  Auto captures complete, but ${#failed[@]} failed:"
  for id in "${failed[@]}"; do echo "   - $id"; done
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
ls -la "$OUT_DIR"
[ ${#failed[@]} -eq 0 ]
