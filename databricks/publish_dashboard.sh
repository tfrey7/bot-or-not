#!/usr/bin/env bash
# Create-or-update the AI/BI dashboard draft from dashboards/overview.lvdash.json,
# then publish it with embedded credentials. The JSON file is the canonical
# definition — edits made in the Databricks UI are overwritten on the next run.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CATALOG="${BON_CATALOG:-bot_or_not}"
DISPLAY_NAME="Bot or Not — Overview"
DASHBOARD_FILE="$SCRIPT_DIR/dashboards/overview.lvdash.json"

source "$SCRIPT_DIR/sql.sh"

DASHBOARD_ID="$(databricks lakeview list --output json | python3 "$SCRIPT_DIR/dashboard_id.py" "$DISPLAY_NAME")"

if [[ -z "$DASHBOARD_ID" ]]; then
  echo "Creating dashboard \"$DISPLAY_NAME\"..."
  DASHBOARD_ID="$(databricks lakeview create \
    --display-name "$DISPLAY_NAME" \
    --serialized-dashboard "$(cat "$DASHBOARD_FILE")" \
    --warehouse-id "$WAREHOUSE_ID" \
    --dataset-catalog "$CATALOG" \
    --output json | python3 "$SCRIPT_DIR/json_get.py" dashboard_id)"
else
  echo "Updating dashboard \"$DISPLAY_NAME\" ($DASHBOARD_ID)..."
  databricks lakeview update "$DASHBOARD_ID" \
    --serialized-dashboard "$(cat "$DASHBOARD_FILE")" \
    --warehouse-id "$WAREHOUSE_ID" \
    --dataset-catalog "$CATALOG" \
    --output json > /dev/null
fi

databricks lakeview publish "$DASHBOARD_ID" \
  --embed-credentials \
  --warehouse-id "$WAREHOUSE_ID" \
  --output json > /dev/null

HOST="$(databricks auth describe --output json | python3 "$SCRIPT_DIR/json_get.py" details.host)"
echo "Published: $HOST/dashboardsv3/$DASHBOARD_ID/published"
