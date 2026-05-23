#!/usr/bin/env bash
set -euo pipefail

# Claim the Firefox dev singleton in this worktree.
#
#   npm run dev
#
# Firefox can only load one copy of the extension at a time. This wrapper
# kills any other strand's running dev server (tracked via a PID file at the
# main checkout) before starting ours, so switching dev to a different
# worktree is just `npm run dev` in that worktree's terminal.
#
# The persistent Firefox profile (configured in vite.config.js) survives the
# kill-restart cycle, so extension storage and open tabs are preserved.

main_worktree=$(git worktree list --porcelain | awk '
  /^worktree / { wt = substr($0, 10) }
  /^branch refs\/heads\/main$/ { print wt; exit }
')

if [ -z "$main_worktree" ]; then
  echo "Error: could not find a worktree on the 'main' branch" >&2
  exit 1
fi

pid_file="$main_worktree/.dev-server.pid"

if [ -f "$pid_file" ]; then
  prev_pid=$(cat "$pid_file")
  if kill -0 "$prev_pid" 2>/dev/null; then
    echo "→ Stopping previous dev server (pid $prev_pid)"
    kill -TERM "$prev_pid" 2>/dev/null || true
    for _ in 1 2 3 4 5; do
      kill -0 "$prev_pid" 2>/dev/null || break
      sleep 1
    done
    kill -KILL "$prev_pid" 2>/dev/null || true
  fi
fi

# web-ext children sometimes outlive their parent npm/vite process.
pkill -f "web-ext run" 2>/dev/null || true

echo $$ > "$pid_file"

exec npx vite dev
