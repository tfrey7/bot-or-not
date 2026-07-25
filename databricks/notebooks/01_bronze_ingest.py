# Databricks notebook source
# MAGIC %md
# MAGIC # 01 — Bronze ingest
# MAGIC
# MAGIC Loads the prepared Bot or Not export (JSONL, one line per user) from the
# MAGIC `bronze.raw` volume into the bronze table `bronze.reports`.
# MAGIC
# MAGIC Ingestion is incremental via `COPY INTO`: the table tracks which volume
# MAGIC files it has already loaded, so each run parses only new snapshots and
# MAGIC appends their rows. To force a full re-ingest (e.g. after changing the
# MAGIC column expressions below), `DROP TABLE bronze.reports` and rerun — the
# MAGIC file tracking resets with the table.
# MAGIC
# MAGIC The `report` payload is kept as a single VARIANT column rather than an
# MAGIC inferred struct: fields like `subredditCounts` are maps keyed by arbitrary
# MAGIC subreddit names, so schema inference would explode them into thousands of
# MAGIC struct fields. Bronze stays schema-on-read; silver does the flattening.

# COMMAND ----------

dbutils.widgets.text("catalog", "bot_or_not")
catalog = dbutils.widgets.get("catalog")
spark.sql(f"USE CATALOG {catalog}")

# COMMAND ----------

spark.sql("""
CREATE TABLE IF NOT EXISTS bronze.reports (
  username     STRING,
  exported_at  TIMESTAMP,
  app_version  STRING,
  report       VARIANT,
  source_file  STRING,
  ingested_at  TIMESTAMP
)
""")

copied = spark.sql(f"""
COPY INTO bronze.reports
FROM (
  SELECT
    parse_json(value):username::string       AS username,
    parse_json(value):exported_at::timestamp AS exported_at,
    parse_json(value):app_version::string    AS app_version,
    parse_json(value):report                 AS report,
    _metadata.file_path                      AS source_file,
    current_timestamp()                      AS ingested_at
  FROM '/Volumes/{catalog}/bronze/raw/'
)
FILEFORMAT = TEXT
""").first().asDict()

# COMMAND ----------

# MAGIC %md
# MAGIC ### A peek at variant extraction — top accounts by bot probability

# COMMAND ----------

display(spark.sql("""
SELECT
  username,
  report:investigation:results:verdict::string        AS verdict,
  report:investigation:results:botProbability::double AS bot_probability,
  report:userStatus::string                           AS user_status
FROM bronze.reports
WHERE report:investigation:status::string = 'done'
ORDER BY bot_probability DESC
LIMIT 20
"""))

# COMMAND ----------

# MAGIC %md
# MAGIC ### Sanity counts — returned to the pipeline runner as the notebook result

# COMMAND ----------

import json

counts = spark.sql("""
SELECT
  count(*)                                               AS total_rows,
  count(DISTINCT source_file)                            AS snapshots,
  count(DISTINCT username)                               AS distinct_users,
  count_if(report:investigation:status::string = 'done') AS investigations_done
FROM bronze.reports
""").first().asDict()

counts["rows_ingested_this_run"] = int(copied.get("num_inserted_rows") or 0)
dbutils.notebook.exit(json.dumps(counts))
