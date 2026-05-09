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

echo "This walks you through capturing the README screenshots one at a time."
echo "Output: $OUT_DIR"
echo ""
echo "Tip: in a separate terminal, run:"
echo "  ./scripts/launch-with-test-scenario.sh"
echo "to start the app pre-loaded with the api/frontend/cli-tool fixtures."
echo ""
read -r -p "Press <enter> to begin… "

cap "01-empty"        "App with no repos added (clean install state)."
cap "02-sidebar"      "Sidebar populated with all 3 fixture repos expanded — show the dirty marker on bug-fix-worktree and the magenta ✦ Claude subgroup."
cap "03-terminal"     "A terminal tab open at one of the worktrees (run something like 'ls -la' or 'git status' so it has visible output)."
cap "04-create-modal" "The 'New worktree' modal open (click the + on a repo node)."
cap "05-delete-modal" "The 'Delete worktree?' modal open (hover a worktree row, click the × icon)."
cap "06-collapsed"    "Sidebar collapsed (⌘B) showing the terminal taking the full window width."
cap "07-multi-tabs"   "Two or more tabs open on the same repo — the new-terminal-at-repo button (>_) lets you have a Claude tab alongside a work tab."

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✨ All screenshots captured."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
ls -la "$OUT_DIR"
