#!/usr/bin/env bash
set -euo pipefail

# Ship an agent's pending commits to main.
#
#   ./scripts/ship.sh [slug]
#   npm run ship [-- <slug>]
#
# Without an argument, infers the slug from the current branch (only works
# when run from inside an agent/<slug> worktree). With an argument, ships
# from wherever the script is invoked.
#
# Steps:
#   1. Verify the agent's worktree is clean.
#   2. Rebase agent/<slug> onto current main (inside the worktree).
#   3. Fast-forward main to the rebased branch (from main checkout).
#
# The worktree and branch stay alive — the agent can immediately start the
# next feature. To tear down the agent itself, use scripts/retire-agent.sh.
#
# If the rebase has conflicts, the script stops; resolve them inside the
# worktree (`git rebase --continue` once clean) and re-run.

slug="${1:-}"

if [ -z "$slug" ]; then
  current_branch=$(git rev-parse --abbrev-ref HEAD)
  if [[ "$current_branch" =~ ^agent/(.+)$ ]]; then
    slug="${BASH_REMATCH[1]}"
  else
    echo "Usage: $0 <slug>" >&2
    echo "  (or run from inside an agent/<slug> worktree to infer the slug)" >&2
    exit 1
  fi
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

if [ -n "$(git -C "$worktree_path" status --porcelain)" ]; then
  echo "Error: $worktree_path has uncommitted changes; commit them first" >&2
  exit 1
fi

if [ -n "$(git -C "$main_worktree" status --porcelain)" ]; then
  echo "Error: main worktree has uncommitted changes; resolve before shipping" >&2
  exit 1
fi

echo "→ Rebasing $branch onto main"
if ! git -C "$worktree_path" rebase main; then
  echo >&2
  echo "Rebase stopped. Resolve conflicts in $worktree_path, run 'git rebase --continue' when clean, then re-run: $0 $slug" >&2
  exit 1
fi

ahead=$(git -C "$main_worktree" rev-list --count "main..$branch")
if [ "$ahead" -eq 0 ]; then
  echo "✓ Nothing to ship: $branch is at main (no commits to land)"
  exit 0
fi

echo "→ Fast-forwarding main ($ahead commit(s) from $branch)"
git -C "$main_worktree" merge --ff-only "$branch"

echo
echo "✓ Shipped $ahead commit(s) from agent $slug to main"
echo "  Worktree $worktree_path stays alive — agent can continue with the next feature."
