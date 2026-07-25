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

WAREHOUSE_ID="$(databricks warehouses list --output json | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['id'])")"
echo "Using SQL warehouse $WAREHOUSE_ID, catalog $CATALOG"

run_sql() {
  databricks api post /api/2.0/sql/statements --json "$(python3 -c "
import json, sys
print(json.dumps({'statement': sys.argv[1], 'warehouse_id': sys.argv[2], 'wait_timeout': '50s'}))
" "$1" "$WAREHOUSE_ID")" > /dev/null
}

run_sql "CREATE CATALOG IF NOT EXISTS $CATALOG"
run_sql "CREATE SCHEMA IF NOT EXISTS $CATALOG.bronze"
run_sql "CREATE VOLUME IF NOT EXISTS $CATALOG.bronze.raw"

echo "Uploading $(basename "$JSONL")..."
databricks fs cp "$JSONL" "dbfs:/Volumes/$CATALOG/bronze/raw/$(basename "$JSONL")" --overwrite

echo "Syncing notebooks into the workspace..."
databricks workspace import-dir "$SCRIPT_DIR/notebooks" "/Workspace/Users/tfrey7@gmail.com/bot-or-not" --overwrite

echo "Done. Open /Workspace/Users/tfrey7@gmail.com/bot-or-not/01_bronze_ingest in Databricks and run it."
