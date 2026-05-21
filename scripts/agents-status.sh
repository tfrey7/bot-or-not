#!/usr/bin/env bash
set -euo pipefail

# Print status of all live agent worktrees.
#
#   ./scripts/agents-status.sh
#   npm run agents
#
# Quick overview for the orchestrator: one row per agent with unshipped
# commit count, working-tree state, and last commit subject.

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

if [ ! -d "$worktrees_root" ]; then
  echo "No agents (no $worktrees_root directory)."
  exit 0
fi

shopt -s nullglob
agents=()
for d in "$worktrees_root"/*/; do
  agents+=("$(basename "$d")")
done
shopt -u nullglob

if [ ${#agents[@]} -eq 0 ]; then
  echo "No agents in $worktrees_root."
  exit 0
fi

echo "${#agents[@]} agent(s):"
printf "  %-10s  %-29s  %5s  %-26s  %s\n" "AGENT" "BECOME" "AHEAD" "WORKING TREE" "LAST COMMIT"

for slug in "${agents[@]}"; do
  worktree_path="$worktrees_root/$slug"
  branch="agent/$slug"
  become_cmd="npm run be-agent -- $slug"

  if ! git -C "$main_worktree" show-ref --verify --quiet "refs/heads/$branch"; then
    printf "  %-10s  %-29s  %5s  %-26s  %s\n" "$slug" "$become_cmd" "?" "no branch (stale dir)" "—"
    continue
  fi

  ahead=$(git -C "$main_worktree" rev-list --count "main..$branch" 2>/dev/null || echo "?")

  mapfile -t status_lines < <(git -C "$worktree_path" status --porcelain 2>/dev/null || true)
  if [ ${#status_lines[@]} -eq 0 ]; then
    working_tree="clean"
  else
    untracked=0
    changed=0
    for line in "${status_lines[@]}"; do
      if [[ "$line" =~ ^\?\? ]]; then
        untracked=$((untracked + 1))
      else
        changed=$((changed + 1))
      fi
    done
    parts=()
    [ $changed -gt 0 ] && parts+=("$changed modified")
    [ $untracked -gt 0 ] && parts+=("$untracked untracked")
    working_tree=""
    for p in "${parts[@]}"; do
      [ -n "$working_tree" ] && working_tree="$working_tree, "
      working_tree="$working_tree$p"
    done
  fi

  last_commit=$(git -C "$worktree_path" log -1 --format="%h %s" 2>/dev/null || echo "—")

  printf "  %-10s  %-29s  %5s  %-26s  %s\n" "$slug" "$become_cmd" "$ahead" "$working_tree" "$last_commit"
done
