#!/bin/bash

# Walk the user through capturing the README screenshots.
# Each step prompts them to set the app up, then runs `screencapture -W` —
# the next click on the treeline-app window saves a PNG to docs/img/.
#
# Why interactive? Headless `screencapture` requires Screen Recording
# permission which is hard to grant programmatically. `-W` works under any
# user with no extra setup.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
OUT_DIR="$PROJECT_ROOT/docs/img"
mkdir -p "$OUT_DIR"

cap() {
  local name=$1
  local desc=$2
  local out="$OUT_DIR/$name.png"
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "📸 $name"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "$desc"
  echo ""
  read -r -p "Press <enter> when the app is ready, then click the window… "
  # -W: wait for window selection, -o: no shadow, -t png: PNG output
  screencapture -W -o -t png "$out"
  echo "✓ Saved $out"
}

# Variant for hover-state captures. `-W` steals focus on click and destroys
# the hover, so we use `-T 5` (5-second timer) instead — the user gets a
# countdown to position the cursor over the target and hold it there. This
# is a *full-screen* capture; crop in Preview afterwards if needed.
cap_hover() {
  local name=$1
  local desc=$2
  local out="$OUT_DIR/$name.png"
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "📸 $name  (timed — hover-state capture)"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "$desc"
  echo ""
  echo "When you press <enter>, a 5-second timer starts. Move the cursor"
  echo "over the target so the hover state is visible, then hold it there"
  echo "until the shutter fires. Crop the resulting full-screen PNG in"
  echo "Preview afterwards if you want a tighter shot."
  read -r -p "Press <enter> to start the 5-second countdown… "
  screencapture -T 5 -o -t png "$out"
  echo "✓ Saved $out"
}

echo "This walks you through capturing the README screenshots one at a time."
echo "Output: $OUT_DIR"
echo ""
echo "Tip: in a separate terminal, run:"
echo "  ./scripts/launch-with-test-scenario.sh"
echo "to start the app pre-loaded with the api/frontend/cli-tool fixtures."
echo ""
read -r -p "Press <enter> to begin… "

cap "01-empty"        "App with no repos added (clean install state)."
cap "02-sidebar"      "Sidebar populated with all 3 fixture repos expanded — show the dirty marker on bug-fix-worktree, the magenta ✦ Claude subgroup, AND the new ‹ collapse button at the top-right of the sidebar header. (This is the README hero — re-shoot whenever the sidebar UX changes.)"
cap "03-terminal"     "A terminal tab open at one of the worktrees (run something like 'ls -la' or 'git status' so it has visible output)."
cap "04-create-modal" "The 'New worktree' modal open (click the + on a repo node)."
cap "05-delete-modal" "The 'Delete worktree?' modal open (hover a worktree row, click the × icon)."
cap "06-collapsed"    "Sidebar collapsed (⌘B) showing the terminal taking the full window width. The › expand button should now be visible in the title bar (it only appears in the collapsed state)."
cap "07-multi-tabs"   "Two or more tabs open on the same repo — the new-terminal-at-repo button (>_) lets you have a Claude tab alongside a work tab."

# ── Feature spotlights ───────────────────────────────────────────────
# These exist because the README mentions the feature but no screenshot
# isolates it; or because today's UX change earned its own capture.

cap "08-filter"               "Filter input typed with text that narrows the visible worktree list to a clear subset (e.g. type 'auth' so only the auth-worktree rows survive)."
cap "11-claude-tab-running"   "Run \`claude\` (or a stand-in like \`sleep 9999\` named claude) in a worktree tab so the magenta \`claude\` AI-CLI badge appears on that worktree row in the sidebar AND the terminal shows Claude's UI. Both panes in one shot."
cap "12-claude-group-expanded" "Crop tight on the ✦ Claude sub-section under one repo, with both claude-style worktrees visible underneath the magenta header."
cap "13-dirty-marker"         "Crop in on the bug-fix-worktree row so the yellow ● dirty marker is unambiguous. A close-up beats a full-window shot for this one."
cap "14-status-dots"          "Two-or-more tabs with at least two different status-dot colours visible at once: e.g. one tab actively running something (green) and one tab sitting idle at a prompt (cyan). Tab bar should be the focal point."

cap "16-discovery-toast"      "The discovered-repo toast (auto-discovery of an untracked repo via PTY cwd).
SETUP:
  • Have at least one fixture repo tracked in the sidebar — the toast contrasts against tracked rows.
  • Reset persisted dismissals first or pick a fresh repo: the toast suppresses re-prompts for paths already in dismissedRepos AND for repoPaths already pending in the renderer's localStorage queue (key: 'treeline.pendingDiscoveries'). Easiest reset: \`rm -f \"\$HOME/Library/Application Support/treeline-app/config.json\"\` and clear localStorage in DevTools (⌥⌘I → Application → Local Storage), or just point it at a repo you've never picked before.
  • Open a tab in a tracked repo, then \`cd\` into a path inside an untracked git repo. Within ~5s a toast slides into the bottom-right reading 'Track <basename>?' with Add / Dismiss / Don't ask again.
  • Capture the window before clicking any of the toast buttons — once Add fires, the toast disappears and the new repo auto-selects in the sidebar."

cap "17-add-after-discovery"  "Just-after state: the moment after clicking Add on the 16-discovery-toast.
The toast is gone, the new repo is at the top of the sidebar with its row auto-selected (highlighted), and any worktrees inside it (e.g. a claude-created \`worktree-*\` under \`✦ Claude\`) have appeared via the worktree-watcher. This is the 'gap closed' shot — pair with 16 in any docs about the auto-discovery flow."

# Hover-state captures — these need cap_hover (timer, not -W) because
# clicking the window to select it would dismiss the hover.
cap_hover "09-hover-repo-actions"     "Hover a repo node so the >_ , + , and × icons are all visible at once. This is the canonical 'what can I do to a repo' shot — backs up three rows of the README's actions table."
cap_hover "10-hover-worktree-delete"  "Hover a worktree row so the × delete affordance is visible on the right edge."
cap_hover "15-sidebar-collapse-btn"   "Hover the new ‹ collapse button at the top-right of the sidebar header so its hover background lights up. Tight crop preferred — this is the receipt for today's UX change."
cap_hover "18-add-button-tooltip"     "Hover the '+ Add repo or worktree' button at the top of the sidebar so its native title-attribute tooltip ('Pick a repo root, a subdirectory, or a worktree path — treeline resolves to the parent repo.') becomes visible. Tight crop on the button + tooltip — this is the discoverability cue for the new path-flexible add flow."

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✨ All screenshots captured."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
ls -la "$OUT_DIR"
