#!/usr/bin/env bash
set -euo pipefail

# Spawn a new agent worktree.
#
#   ./scripts/new-agent.sh <slug>
#   npm run new-agent -- <slug>
#
# Creates branch `agent/<slug>` from main, checks it out as a worktree at
# ../<project>-worktrees/<slug>/, and symlinks node_modules and .env from the
# main checkout so the worktree can run npm scripts immediately. The slug
# names an agent identity (alice, frontend-work, etc.), not a feature — the
# agent ships many features over its lifetime.

if [ $# -lt 1 ]; then
  echo "Usage: $0 <slug>" >&2
  echo "  e.g. $0 alice" >&2
  exit 1
fi

slug="$1"

if [[ ! "$slug" =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
  echo "Error: slug must be kebab-case (lowercase letters, digits, hyphens; cannot start with hyphen)" >&2
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

if [ -n "$(git -C "$main_worktree" status --porcelain)" ]; then
  echo "Error: main worktree has uncommitted changes; commit or stash first" >&2
  exit 1
fi

if git -C "$main_worktree" show-ref --verify --quiet "refs/heads/$branch"; then
  echo "Error: branch '$branch' already exists" >&2
  exit 1
fi

if [ -e "$worktree_path" ]; then
  echo "Error: '$worktree_path' already exists" >&2
  exit 1
fi

mkdir -p "$worktrees_root"

echo "→ Creating worktree $worktree_path on branch $branch"
git -C "$main_worktree" worktree add -b "$branch" "$worktree_path" main

echo "→ Symlinking node_modules"
ln -s "$main_worktree/node_modules" "$worktree_path/node_modules"

if [ -f "$main_worktree/.env" ]; then
  echo "→ Symlinking .env"
  ln -s "$main_worktree/.env" "$worktree_path/.env"
fi

echo
echo "✓ Worktree ready: $worktree_path"
echo
echo "Next:"
echo "  cd $worktree_path && claude"
echo "  That session is agent $slug. Start working — it can ship multiple features over its lifetime."
