# Databricks notebook source
# MAGIC %md
# MAGIC # 01 — Bronze ingest
# MAGIC
# MAGIC Loads the prepared Bot or Not export (JSONL, one line per user) from the
# MAGIC `bronze.raw` volume into the bronze table `bronze.reports`.
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
CREATE OR REPLACE TABLE bronze.reports AS
SELECT
  data:username::string        AS username,
  data:exported_at::timestamp  AS exported_at,
  data:app_version::string     AS app_version,
  data:report                  AS report,
  _metadata.file_path          AS source_file,
  current_timestamp()          AS ingested_at
FROM read_files(
  '/Volumes/' || current_catalog() || '/bronze/raw/',
  format => 'json',
  singleVariantColumn => 'data'
)
""")

# COMMAND ----------

# MAGIC %md
# MAGIC ### Sanity checks — row count and a peek at variant extraction

# COMMAND ----------

display(spark.sql("""
SELECT
  count(*)                                                          AS users,
  count_if(report:investigation IS NOT NULL)                        AS with_investigation,
  count_if(report:investigation:status::string = 'done')            AS investigations_done,
  count_if(report:activityData IS NOT NULL)                         AS with_activity_data
FROM bronze.reports
"""))

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
