#!/usr/bin/env bash
# Headless equivalent of notebooks/02_silver_build.py: rebuild the silver
# tables from bronze.reports, then print sanity counts. Keep the SQL in
# sync with the notebook — the notebook is the interactive copy.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CATALOG="${BON_CATALOG:-bot_or_not}"
source "$SCRIPT_DIR/sql.sh"

echo "Building $CATALOG.silver on warehouse $WAREHOUSE_ID..."
run_sql "CREATE SCHEMA IF NOT EXISTS $CATALOG.silver"

run_sql "
CREATE OR REPLACE TABLE $CATALOG.silver.users AS
WITH ranked AS (
  SELECT *,
    ROW_NUMBER() OVER (PARTITION BY username ORDER BY exported_at DESC) AS recency
  FROM $CATALOG.bronze.reports
)
SELECT
  username,
  exported_at                                                    AS snapshot_at,
  report:count::int                                              AS report_count,
  to_timestamp(report:lastReportedAt::bigint / 1000)             AS last_reported_at,
  report:userStatus::string                                      AS user_status,
  report:totalKarma::bigint                                      AS total_karma,
  to_timestamp(report:createdAt::bigint / 1000)                  AS account_created_at,
  report:botBouncerStatus::string                                AS bot_bouncer_status,
  report:ringId::string                                          AS ring_id,
  report:profileHidden::boolean                                  AS profile_hidden,
  report:investigation:status::string                            AS investigation_status,
  report:investigation:results:verdict::string                   AS verdict,
  report:investigation:results:botProbability::double            AS bot_probability,
  report:investigation:results:confidence::double                AS verdict_confidence,
  report:investigation:results:persona:label::string             AS persona_label,
  report:investigation:results:region:code::string               AS region_code,
  report:investigation:results:demographics:age_band::string     AS age_band,
  to_timestamp(report:investigation:results:runAt::bigint / 1000) AS investigated_at,
  report:investigation:results:model::string                     AS investigation_model,
  report:investigation:results:costUsd::double                   AS investigation_cost_usd
FROM ranked
WHERE recency = 1"
echo "silver.users built"

run_sql "
CREATE OR REPLACE TABLE $CATALOG.silver.user_snapshots AS
SELECT
  username,
  exported_at,
  source_file,
  report:userStatus::string                            AS user_status,
  report:totalKarma::bigint                            AS total_karma,
  report:botBouncerStatus::string                      AS bot_bouncer_status,
  report:ringId::string                                AS ring_id,
  report:investigation:status::string                  AS investigation_status,
  report:investigation:results:verdict::string         AS verdict,
  report:investigation:results:botProbability::double  AS bot_probability,
  to_timestamp(report:investigation:results:runAt::bigint / 1000) AS investigated_at
FROM $CATALOG.bronze.reports"
echo "silver.user_snapshots built"

run_sql "
CREATE OR REPLACE TABLE $CATALOG.silver.factors AS
WITH ranked AS (
  SELECT *,
    ROW_NUMBER() OVER (PARTITION BY username ORDER BY exported_at DESC) AS recency
  FROM $CATALOG.bronze.reports
)
SELECT
  username,
  factor.value:key::string        AS factor_key,
  factor.value:score::double      AS score,
  factor.value:confidence::double AS confidence,
  factor.value:reasoning::string  AS reasoning
FROM ranked,
  LATERAL variant_explode(report:investigation:results:factors) AS factor
WHERE recency = 1"
echo "silver.factors built"

run_sql "
CREATE OR REPLACE TABLE $CATALOG.silver.activity_events AS
WITH events AS (
  SELECT
    username,
    'post' AS kind,
    event.ts,
    cast(report:activityData:postSubreddits AS ARRAY<STRING>)[event.pos] AS subreddit
  FROM $CATALOG.bronze.reports
  LATERAL VIEW posexplode(cast(report:activityData:postTimestamps AS ARRAY<BIGINT>)) event AS pos, ts
  UNION ALL
  SELECT
    username,
    'comment' AS kind,
    event.ts,
    cast(report:activityData:commentSubreddits AS ARRAY<STRING>)[event.pos] AS subreddit
  FROM $CATALOG.bronze.reports
  LATERAL VIEW posexplode(cast(report:activityData:commentTimestamps AS ARRAY<BIGINT>)) event AS pos, ts
)
SELECT DISTINCT
  username,
  kind,
  to_timestamp(ts / 1000)     AS occurred_at,
  lower(nullif(subreddit, '')) AS subreddit
FROM events"
echo "silver.activity_events built"

run_sql "
CREATE OR REPLACE TABLE $CATALOG.silver.report_events AS
SELECT DISTINCT
  username,
  to_timestamp(entry.value:at::bigint / 1000)                            AS reported_at,
  entry.value:permalink::string                                          AS permalink,
  nullif(regexp_extract(entry.value:permalink::string, '/comments/([a-z0-9]+)', 1), '') AS thread_id,
  lower(entry.value:subreddit::string)                                   AS subreddit,
  entry.value:postTitle::string                                          AS post_title,
  entry.value:kind::string                                               AS item_kind
FROM $CATALOG.bronze.reports,
  LATERAL variant_explode(report:history) AS entry"
echo "silver.report_events built"

echo "Silver rebuilt:"
run_sql "
SELECT
  (SELECT count(*) FROM $CATALOG.silver.users)           AS users,
  (SELECT count(*) FROM $CATALOG.silver.user_snapshots)  AS user_snapshots,
  (SELECT count(*) FROM $CATALOG.silver.factors)         AS factors,
  (SELECT count(*) FROM $CATALOG.silver.activity_events) AS activity_events,
  (SELECT count(*) FROM $CATALOG.silver.report_events)   AS report_events"
