#!/usr/bin/env bash
set -euo pipefail

# Retire an agent: remove its worktree and delete its branch.
#
#   ./scripts/retire-agent.sh <slug>
#   ./scripts/retire-agent.sh <slug> --force
#   npm run retire-agent -- <slug>
#
# Refuses to retire if the agent has uncommitted changes or unshipped commits.
# Run `npm run ship` first to land them, or pass --force to discard them.
# If the agent is the current dev-switch active target, the dev server is
# stopped first.

slug=""
force=0

for arg in "$@"; do
  case "$arg" in
    --force) force=1 ;;
    --*) echo "Unknown flag: $arg" >&2; exit 1 ;;
    *)
      if [ -z "$slug" ]; then
        slug="$arg"
      else
        echo "Error: too many arguments" >&2; exit 1
      fi
      ;;
  esac
done

if [ -z "$slug" ]; then
  echo "Usage: $0 <slug> [--force]" >&2
  exit 1
fi

main_worktree=$(git worktree list --porcelain | awk '
  /^worktree / { wt = substr($0, 10) }
  /^branch refs\/heads\/main$/ { print wt; exit }
')

if [ -z "$main_worktree" ]; then
  echo "Error: could not find a worktree on the 'main' branch" >&2
  exit 1
fi

project_name=$(basename "$main_worktree")
worktrees_root="$(cd "$main_worktree/.." && pwd)/${project_name}-worktrees"

branch="agent/$slug"
worktree_path="$worktrees_root/$slug"

if [ ! -d "$worktree_path" ]; then
  echo "Error: worktree $worktree_path does not exist" >&2
  exit 1
fi

if [ "$force" -eq 0 ]; then
  if [ -n "$(git -C "$worktree_path" status --porcelain)" ]; then
    echo "Error: $worktree_path has uncommitted changes." >&2
    echo "       Commit and ship them, or re-run with --force to discard." >&2
    exit 1
  fi
  ahead=$(git -C "$main_worktree" rev-list --count "main..$branch" 2>/dev/null || echo 0)
  if [ "$ahead" -gt 0 ]; then
    echo "Error: $branch has $ahead unshipped commit(s) ahead of main." >&2
    echo "       Run 'npm run ship -- $slug' first, or re-run with --force to discard." >&2
    exit 1
  fi
fi

# If this agent is currently the dev-switch active target, stop the dev server
# so we're not yanking its worktree out from under a live process.
active_file="$main_worktree/.active-feature"
if [ -f "$active_file" ] && [ "$(cat "$active_file")" = "$slug" ]; then
  echo "→ Stopping dev server (this agent is the current active target)"
  "$main_worktree/scripts/switch-dev.sh" --stop
fi

echo "→ Removing worktree $worktree_path"
if [ "$force" -eq 1 ]; then
  git -C "$main_worktree" worktree remove --force "$worktree_path"
else
  git -C "$main_worktree" worktree remove "$worktree_path"
fi

echo "→ Deleting branch $branch"
if [ "$force" -eq 1 ]; then
  git -C "$main_worktree" branch -D "$branch"
else
  git -C "$main_worktree" branch -d "$branch"
fi

echo
echo "✓ Retired agent $slug"
