# Databricks notebook source
# MAGIC %md
# MAGIC # 02 — Silver build
# MAGIC
# MAGIC Normalizes the bronze VARIANT payloads into relational tables. One table
# MAGIC per grain:
# MAGIC
# MAGIC | Table | Grain |
# MAGIC |---|---|
# MAGIC | `silver.users` | one row per user — latest snapshot wins |
# MAGIC | `silver.user_snapshots` | one row per user × snapshot — the longitudinal history |
# MAGIC | `silver.factors` | one row per user × investigation factor |
# MAGIC | `silver.activity_events` | one row per post/comment the user made |
# MAGIC | `silver.report_events` | one row per operator report click, thread ID parsed from the permalink |
# MAGIC
# MAGIC Timestamps in the payload are unix **milliseconds** throughout.
# MAGIC Headless copy of this build: `databricks/rebuild_silver.sh` — keep in sync.

# COMMAND ----------

dbutils.widgets.text("catalog", "bot_or_not")
catalog = dbutils.widgets.get("catalog")
spark.sql(f"USE CATALOG {catalog}")
spark.sql("CREATE SCHEMA IF NOT EXISTS silver")

# COMMAND ----------

# MAGIC %md
# MAGIC ### `silver.users` — current state, latest snapshot per user

# COMMAND ----------

spark.sql("""
CREATE OR REPLACE TABLE silver.users AS
WITH ranked AS (
  SELECT *,
    ROW_NUMBER() OVER (PARTITION BY username ORDER BY exported_at DESC) AS recency
  FROM bronze.reports
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
WHERE recency = 1
""")

# COMMAND ----------

# MAGIC %md
# MAGIC ### `silver.user_snapshots` — every user × snapshot, powers outcome analysis over time

# COMMAND ----------

spark.sql("""
CREATE OR REPLACE TABLE silver.user_snapshots AS
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
FROM bronze.reports
""")

# COMMAND ----------

# MAGIC %md
# MAGIC ### `silver.factors` — investigation factor scores, exploded from the latest snapshot

# COMMAND ----------

spark.sql("""
CREATE OR REPLACE TABLE silver.factors AS
WITH ranked AS (
  SELECT *,
    ROW_NUMBER() OVER (PARTITION BY username ORDER BY exported_at DESC) AS recency
  FROM bronze.reports
)
SELECT
  username,
  factor.value:key::string        AS factor_key,
  factor.value:score::double      AS score,
  factor.value:confidence::double AS confidence,
  factor.value:reasoning::string  AS reasoning
FROM ranked,
  LATERAL variant_explode(report:investigation:results:factors) AS factor
WHERE recency = 1
""")

# COMMAND ----------

# MAGIC %md
# MAGIC ### `silver.activity_events` — one row per post/comment
# MAGIC
# MAGIC Unioned across **all** snapshots then deduped: the extension's fetch window
# MAGIC slides, so older snapshots can hold events the newest fetch no longer covers.
# MAGIC Subreddit arrays arrived in a later app version — missing arrays cast to
# MAGIC NULL, so older snapshots contribute events with a NULL subreddit.

# COMMAND ----------

spark.sql("""
CREATE OR REPLACE TABLE silver.activity_events AS
WITH events AS (
  SELECT
    username,
    'post' AS kind,
    event.ts,
    cast(report:activityData:postSubreddits AS ARRAY<STRING>)[event.pos] AS subreddit
  FROM bronze.reports
  LATERAL VIEW posexplode(cast(report:activityData:postTimestamps AS ARRAY<BIGINT>)) event AS pos, ts
  UNION ALL
  SELECT
    username,
    'comment' AS kind,
    event.ts,
    cast(report:activityData:commentSubreddits AS ARRAY<STRING>)[event.pos] AS subreddit
  FROM bronze.reports
  LATERAL VIEW posexplode(cast(report:activityData:commentTimestamps AS ARRAY<BIGINT>)) event AS pos, ts
)
SELECT DISTINCT
  username,
  kind,
  to_timestamp(ts / 1000)      AS occurred_at,
  lower(nullif(subreddit, '')) AS subreddit
FROM events
""")

# COMMAND ----------

# MAGIC %md
# MAGIC ### `silver.report_events` — operator report clicks, thread ID parsed from the permalink

# COMMAND ----------

spark.sql("""
CREATE OR REPLACE TABLE silver.report_events AS
SELECT DISTINCT
  username,
  to_timestamp(entry.value:at::bigint / 1000)                            AS reported_at,
  entry.value:permalink::string                                          AS permalink,
  nullif(regexp_extract(entry.value:permalink::string, '/comments/([a-z0-9]+)', 1), '') AS thread_id,
  lower(entry.value:subreddit::string)                                   AS subreddit,
  entry.value:postTitle::string                                          AS post_title,
  entry.value:kind::string                                               AS item_kind
FROM bronze.reports,
  LATERAL variant_explode(report:history) AS entry
""")

# COMMAND ----------

# MAGIC %md
# MAGIC First longitudinal query — status changes between snapshots:

# COMMAND ----------

display(spark.sql("""
WITH ordered AS (
  SELECT username, exported_at, user_status,
    LAG(user_status) OVER (PARTITION BY username ORDER BY exported_at) AS previous_status
  FROM silver.user_snapshots
)
SELECT username, exported_at, previous_status, user_status
FROM ordered
WHERE previous_status IS NOT NULL AND user_status <> previous_status
ORDER BY exported_at DESC
"""))

# COMMAND ----------

# MAGIC %md
# MAGIC ### Sanity counts — returned to the pipeline runner as the notebook result

# COMMAND ----------

import json

counts = spark.sql("""
SELECT
  (SELECT count(*) FROM silver.users)           AS users,
  (SELECT count(*) FROM silver.user_snapshots)  AS user_snapshots,
  (SELECT count(*) FROM silver.factors)         AS factors,
  (SELECT count(*) FROM silver.activity_events) AS activity_events,
  (SELECT count(*) FROM silver.report_events)   AS report_events
""").first().asDict()

dbutils.notebook.exit(json.dumps(counts))
