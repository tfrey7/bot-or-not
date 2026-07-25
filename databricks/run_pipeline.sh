#!/usr/bin/env bash
# Full medallion rebuild, bronze upward. The single pipeline entry point:
# add new layers here (gold next), not to the load-export skill.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

"$SCRIPT_DIR/rebuild_bronze.sh"
"$SCRIPT_DIR/rebuild_silver.sh"
