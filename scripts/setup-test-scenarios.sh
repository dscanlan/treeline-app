#!/bin/bash

# Setup test scenarios for treeline-app screenshots and manual testing.
# Creates multiple projects and worktrees under a temporary code root.
#
# Adapted from /Users/dominicscanlan/code/treeline/scripts/setup-test-scenarios.sh
# to fit the Electron port: same fixture shape, no treeline-specific bits.

set -e

TEST_CODE_ROOT_INPUT="${1:-./.test-code-root}"
TEST_CODE_ROOT="$(mkdir -p "$TEST_CODE_ROOT_INPUT" && cd "$TEST_CODE_ROOT_INPUT" && pwd)"
PROJECTS=("api" "frontend" "cli-tool")
DEFAULT_BRANCH="main"

echo "🚀 Creating test scenario in: $TEST_CODE_ROOT"

create_project() {
  local project_name=$1
  local project_path="$TEST_CODE_ROOT/$project_name"

  echo ""
  echo "📦 Setting up project: $project_name"
  mkdir -p "$project_path"
  cd "$project_path"

  git init --quiet --initial-branch "$DEFAULT_BRANCH"
  git config user.name "Test User"
  git config user.email "test@example.com"
  # The user has 1Password git signing globally; force it off in fixtures so
  # `git commit` doesn't block on a signing prompt.
  git config commit.gpgsign false
  git config tag.gpgsign false
  git config gpg.format openpgp

  create_branch_with_worktree() {
    local branch_name=$1
    local worktree_path=$2
    local commit_message=$3
    local content_line=$4

    git checkout -q -b "$branch_name" "$DEFAULT_BRANCH"
    echo "$content_line" >> README.md
    git add README.md
    git commit -q --no-gpg-sign -m "$commit_message"
    git checkout -q "$DEFAULT_BRANCH"
    git worktree add -q "$worktree_path" "$branch_name"
  }

  echo "# $project_name" > README.md
  git add README.md
  git commit -q --no-gpg-sign -m "Initial commit"

  create_branch_with_worktree \
    "feature/auth" "auth-worktree" "Add auth module" "auth implementation"

  create_branch_with_worktree \
    "feature/api-v2" "api-v2-worktree" "API v2 changes" "api v2"

  create_branch_with_worktree \
    "fix/bug-123" "bug-fix-worktree" "Fix bug 123" "bug fix"

  # Make the bug-fix worktree dirty so the yellow indicator shows up.
  if [ -d "bug-fix-worktree" ]; then
    echo "uncommitted work in progress" >> "bug-fix-worktree/README.md"
  fi

  # Two Claude Code-style worktrees per project (shows the magenta ✦ grouping).
  mkdir -p "$project_path/.claude/worktrees"
  for i in 1 2; do
    claude_wt_name="claude-branch-$i"
    create_branch_with_worktree \
      "worktree-$claude_wt_name" \
      ".claude/worktrees/$claude_wt_name" \
      "Claude task $i" \
      "claude work iteration $i"
  done

  git checkout -q "$DEFAULT_BRANCH"

  echo "✓ Project '$project_name' ready"
}

cd "$TEST_CODE_ROOT"
for project in "${PROJECTS[@]}"; do
  create_project "$project"
done

# Marker so the launcher can safely clean this dir up later.
touch "$TEST_CODE_ROOT/.treeline-test-scenario"

# Emit the absolute root so callers can capture it.
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✨ Test scenario setup complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Test root: $TEST_CODE_ROOT"
echo "  Projects:  ${PROJECTS[*]}"
echo "  Each repo gets: main, feature/auth, feature/api-v2, fix/bug-123 (dirty),"
echo "                  + 2 Claude-style worktrees under .claude/worktrees/"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Use scripts/launch-with-test-scenario.sh to launch treeline-app preloaded"
echo "with these repos. Or open the app manually and use '+ Add repo' to point"
echo "at each project under: $TEST_CODE_ROOT"
echo ""
