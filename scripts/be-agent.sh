#!/usr/bin/env bash
set -euo pipefail

# Assume the identity of an existing agent: cd into its worktree and exec
# claude there. Run in a new terminal tab — that tab becomes agent <slug>'s
# session for its lifetime. When claude exits, the tab returns to its parent
# shell.
#
#   ./scripts/be-agent.sh <slug>
#   npm run be-agent -- <slug>

if [ $# -lt 1 ]; then
  echo "Usage: $0 <slug>" >&2
  echo "       npm run be-agent -- <slug>" >&2
  exit 1
fi

slug="$1"

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
worktree_path="$worktrees_root/$slug"

if [ ! -d "$worktree_path" ]; then
  echo "Error: agent '$slug' does not exist (no worktree at $worktree_path)" >&2
  echo "       Run 'npm run new-agent -- $slug' to create it." >&2
  exit 1
fi

if ! command -v claude >/dev/null 2>&1; then
  echo "Error: 'claude' CLI not found on PATH" >&2
  exit 1
fi

cd "$worktree_path"
exec claude
