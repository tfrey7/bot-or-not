#!/usr/bin/env bash
# Headless equivalent of notebooks/01_bronze_ingest.py: rebuild
# bronze.reports from everything in the bronze.raw volume via the SQL
# Statements API, then print sanity counts. Keep the CTAS in sync with
# the notebook — the notebook is the interactive copy of this build.
set -euo pipefail

CATALOG="${BON_CATALOG:-bot_or_not}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/sql.sh"

echo "Rebuilding $CATALOG.bronze.reports on warehouse $WAREHOUSE_ID..."
run_sql "
CREATE OR REPLACE TABLE $CATALOG.bronze.reports AS
SELECT
  data:username::string        AS username,
  data:exported_at::timestamp  AS exported_at,
  data:app_version::string     AS app_version,
  data:report                  AS report,
  _metadata.file_path          AS source_file,
  current_timestamp()          AS ingested_at
FROM read_files(
  '/Volumes/$CATALOG/bronze/raw/',
  format => 'json',
  singleVariantColumn => 'data'
)"

echo "Bronze rebuilt:"
run_sql "
SELECT
  count(*)                                               AS total_rows,
  count(DISTINCT source_file)                            AS snapshots,
  count(DISTINCT username)                               AS distinct_users,
  count_if(report:investigation:status::string = 'done') AS investigations_done
FROM $CATALOG.bronze.reports"
