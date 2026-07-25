#!/usr/bin/env bash
# Upload the newest prepared JSONL (and its source backup) to the Unity
# Catalog volume, creating catalog/schema/volume on first run, then sync
# the notebooks into the workspace. Requires `databricks auth login` to
# have been run for the DEFAULT profile.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CATALOG="${BON_CATALOG:-bot_or_not}"

JSONL="$(ls -t "$SCRIPT_DIR"/data/reports-*.jsonl 2>/dev/null | head -1)"
if [[ -z "$JSONL" ]]; then
  echo "No prepared JSONL found — run python3 databricks/prepare_export.py first." >&2
  exit 1
fi

source "$SCRIPT_DIR/sql.sh"
echo "Using SQL warehouse $WAREHOUSE_ID, catalog $CATALOG"

run_sql "CREATE CATALOG IF NOT EXISTS $CATALOG"
run_sql "CREATE SCHEMA IF NOT EXISTS $CATALOG.bronze"
run_sql "CREATE VOLUME IF NOT EXISTS $CATALOG.bronze.raw"

echo "Uploading $(basename "$JSONL")..."
databricks fs cp "$JSONL" "dbfs:/Volumes/$CATALOG/bronze/raw/$(basename "$JSONL")" --overwrite

echo "Done. Run ./databricks/run_pipeline.py to rebuild the tables."
