# Databricks notebook source
# MAGIC %md
# MAGIC # 03 — Gold build
# MAGIC
# MAGIC Coordination-network layer. First feature: **subreddit fingerprints** —
# MAGIC each user's attention distribution across subreddits as a TF-IDF-weighted
# MAGIC sparse vector (one row per user × subreddit). Downstream features
# MAGIC (similarity edges, ring candidates) compare these vectors.
# MAGIC
# MAGIC - `share` (TF) — events in this subreddit ÷ the user's total events, so
# MAGIC   prolific and light posters compare by attention shape, not volume.
# MAGIC - `idf` — `ln(total users / users active in this subreddit)`, computed
# MAGIC   from our own tracked population: overlap in a niche subreddit is
# MAGIC   evidence, overlap in a mega-subreddit is noise (idf → 0).
# MAGIC - `weight` = share × idf — what the similarity math uses.
# MAGIC
# MAGIC Events with a NULL subreddit (pre-`postSubreddits` snapshots) drop out.

# COMMAND ----------

dbutils.widgets.text("catalog", "bot_or_not")
catalog = dbutils.widgets.get("catalog")
spark.sql(f"USE CATALOG {catalog}")
spark.sql("CREATE SCHEMA IF NOT EXISTS gold")

# COMMAND ----------

spark.sql("""
CREATE OR REPLACE TABLE gold.subreddit_fingerprints AS
WITH user_subreddit AS (
  SELECT username, subreddit, count(*) AS events
  FROM silver.activity_events
  WHERE subreddit IS NOT NULL
  GROUP BY username, subreddit
),
user_totals AS (
  SELECT username, sum(events) AS total_events
  FROM user_subreddit
  GROUP BY username
),
subreddit_reach AS (
  SELECT subreddit, count(*) AS users_in_subreddit
  FROM user_subreddit
  GROUP BY subreddit
),
population AS (
  SELECT count(DISTINCT username) AS total_users
  FROM user_subreddit
)
SELECT
  user_subreddit.username,
  user_subreddit.subreddit,
  user_subreddit.events,
  user_subreddit.events / user_totals.total_events AS share,
  ln(population.total_users / subreddit_reach.users_in_subreddit) AS idf,
  (user_subreddit.events / user_totals.total_events)
    * ln(population.total_users / subreddit_reach.users_in_subreddit) AS weight
FROM user_subreddit
JOIN user_totals USING (username)
JOIN subreddit_reach USING (subreddit)
CROSS JOIN population
""")

# COMMAND ----------

# MAGIC %md
# MAGIC ### Peek — the known ring pair's fingerprints
# MAGIC
# MAGIC The two accounts sharing a `ring_id` are the ground-truth pair the
# MAGIC similarity math must eventually light up. Their top-weighted subreddits
# MAGIC should visibly overlap.

# COMMAND ----------

display(spark.sql("""
SELECT fingerprint.username, fingerprint.subreddit, fingerprint.events,
  round(fingerprint.share, 3) AS share,
  round(fingerprint.idf, 2)   AS idf,
  round(fingerprint.weight, 3) AS weight
FROM gold.subreddit_fingerprints fingerprint
JOIN silver.users users ON users.username = fingerprint.username
WHERE users.ring_id IS NOT NULL
ORDER BY fingerprint.username, fingerprint.weight DESC
"""))

# COMMAND ----------

# MAGIC %md
# MAGIC ### Sanity counts — returned to the pipeline runner as the notebook result

# COMMAND ----------

import json

counts = spark.sql("""
SELECT
  count(*)                   AS fingerprint_rows,
  count(DISTINCT username)   AS users_with_fingerprint,
  count(DISTINCT subreddit)  AS distinct_subreddits
FROM gold.subreddit_fingerprints
""").first().asDict()

dbutils.notebook.exit(json.dumps(counts))
