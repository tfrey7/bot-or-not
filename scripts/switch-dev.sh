#!/usr/bin/env bash
set -euo pipefail

# Switch which feature worktree is live in Firefox.
#
#   ./scripts/switch-dev.sh <slug>     Make <slug>'s worktree active
#   ./scripts/switch-dev.sh main       Make the main checkout itself active
#   ./scripts/switch-dev.sh --stop     Stop the dev server with no replacement
#   ./scripts/switch-dev.sh --status   Show what is currently active
#   npm run dev-switch -- <slug>       Same, via npm alias
#
# Kills any running `npm run dev` (tracked via .dev-server.pid at main), then
# spawns a new one in ../bot-or-not-worktrees/<slug>/ in the background.
# Firefox's profile is persistent (configured in vite.config.js), so extension
# storage and the open reports tab survive the kill-restart cycle.

main_worktree=$(git worktree list --porcelain | awk '
  /^worktree / { wt = substr($0, 10) }
  /^branch refs\/heads\/main$/ { print wt; exit }
')

if [ -z "$main_worktree" ]; then
  echo "Error: could not find a worktree on the 'main' branch" >&2
  exit 1
fi

pid_file="$main_worktree/.dev-server.pid"
active_file="$main_worktree/.active-feature"
log_file="$main_worktree/.dev-server.log"

stop_running() {
  if [ -f "$pid_file" ]; then
    pid=$(cat "$pid_file")
    if kill -0 "$pid" 2>/dev/null; then
      echo "→ Stopping dev server (pid $pid)"
      kill -TERM "$pid" 2>/dev/null || true
      for _ in 1 2 3 4 5; do
        kill -0 "$pid" 2>/dev/null || break
        sleep 1
      done
      kill -KILL "$pid" 2>/dev/null || true
    fi
    rm -f "$pid_file" "$active_file"
  fi

  # web-ext children sometimes survive npm exiting cleanly; sweep them.
  pkill -f "web-ext run" 2>/dev/null || true
}

slug="${1:-}"

if [ "$slug" = "--status" ]; then
  if [ -f "$active_file" ]; then
    echo "Active feature: $(cat "$active_file")"
    if [ -f "$pid_file" ]; then
      pid=$(cat "$pid_file")
      if kill -0 "$pid" 2>/dev/null; then
        echo "Dev server: running (pid $pid)"
      else
        echo "Dev server: stale PID, no longer running"
      fi
    fi
  else
    echo "No active feature"
  fi
  exit 0
fi

if [ "$slug" = "--stop" ]; then
  stop_running
  echo "✓ Dev server stopped"
  exit 0
fi

if [ -z "$slug" ]; then
  echo "Usage: $0 <slug>" >&2
  echo "       $0 --stop" >&2
  echo "       $0 --status" >&2
  exit 1
fi

if [ "$slug" = "main" ]; then
  worktree_path="$main_worktree"
else
  project_name=$(basename "$main_worktree")
  worktrees_root="$(cd "$main_worktree/.." && pwd)/${project_name}-worktrees"
  worktree_path="$worktrees_root/$slug"

  if [ ! -d "$worktree_path" ]; then
    echo "Error: worktree $worktree_path does not exist" >&2
    echo "       run 'npm run new-agent -- $slug' first" >&2
    exit 1
  fi
fi

stop_running

echo "→ Starting dev server in $worktree_path"
(
  cd "$worktree_path"
  nohup npm run dev > "$log_file" 2>&1 &
  echo $! > "$pid_file"
)
echo "$slug" > "$active_file"

echo
echo "✓ Active feature: $slug"
echo "  Logs:   $log_file"
echo "  Status: $0 --status"
echo "  Stop:   $0 --stop"
