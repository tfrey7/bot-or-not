# Sourced by ingest.sh / publish_dashboard.sh: resolves the SQL warehouse
# and provides run_sql, which executes one statement via run_sql.py.

SQL_SH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

WAREHOUSE_ID="$(databricks warehouses list --output json | python3 "$SQL_SH_DIR/json_get.py" 0.id)"

run_sql() {
  python3 "$SQL_SH_DIR/run_sql.py" "$1" "$WAREHOUSE_ID"
}
