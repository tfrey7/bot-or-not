# Databricks notebook source
# MAGIC %md
# MAGIC # 03 — Gold build
# MAGIC
# MAGIC Analysis layer: **subreddit fingerprints** (coordination-network base),
# MAGIC **region verdicts** and **subreddit bot share** (geography / territory
# MAGIC aggregates behind the dashboard's Geography page).
# MAGIC
# MAGIC Fingerprints — each user's attention distribution across subreddits as a
# MAGIC TF-IDF-weighted sparse vector (one row per user × subreddit). Downstream
# MAGIC features (similarity edges, ring candidates) compare these vectors.
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
# MAGIC ### `gold.region_verdicts` — verdict mix per AI-inferred region
# MAGIC
# MAGIC Only verdicted accounts with a region count toward `users`, so `bot_rate`
# MAGIC is bot-side ÷ verdicted. Every region is kept — consumers apply their own
# MAGIC sample-size floor on `users`.

# COMMAND ----------

spark.sql("""
CREATE OR REPLACE TABLE gold.region_verdicts AS
SELECT
  region_code,
  count(*) AS users,
  count_if(verdict IN ('bot', 'likely-bot')) AS bot_side,
  count_if(verdict IN ('human', 'likely-human')) AS human_side,
  count_if(verdict = 'uncertain') AS uncertain,
  count_if(verdict IN ('bot', 'likely-bot')) / count(*) AS bot_rate
FROM silver.users
WHERE region_code IS NOT NULL AND verdict IS NOT NULL
GROUP BY region_code
""")

# COMMAND ----------

# MAGIC %md
# MAGIC ### `gold.subreddit_bot_share` — how bot-populated each subreddit is
# MAGIC
# MAGIC The denominator is *our tracked users* active in the subreddit, not its
# MAGIC real population — shares compare across subreddits, they aren't absolute.
# MAGIC Users without a verdict count toward `tracked_users` and dilute the share.

# COMMAND ----------

spark.sql("""
CREATE OR REPLACE TABLE gold.subreddit_bot_share AS
WITH per_user AS (
  SELECT
    events.subreddit,
    events.username,
    max(CASE WHEN users.verdict IN ('bot', 'likely-bot') THEN 1 ELSE 0 END) AS is_bot,
    count(*) AS events
  FROM silver.activity_events events
  JOIN silver.users users USING (username)
  WHERE events.subreddit IS NOT NULL
  GROUP BY events.subreddit, events.username
)
SELECT
  subreddit,
  count(*) AS tracked_users,
  sum(is_bot) AS bot_accounts,
  sum(CASE WHEN is_bot = 1 THEN events ELSE 0 END) AS bot_events,
  sum(is_bot) / count(*) AS bot_share
FROM per_user
GROUP BY subreddit
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
  (SELECT count(*) FROM gold.subreddit_fingerprints)                          AS fingerprint_rows,
  (SELECT count(DISTINCT username) FROM gold.subreddit_fingerprints)          AS users_with_fingerprint,
  (SELECT count(DISTINCT subreddit) FROM gold.subreddit_fingerprints)         AS distinct_subreddits,
  (SELECT count(*) FROM gold.region_verdicts)                                 AS regions,
  (SELECT count(*) FROM gold.subreddit_bot_share)                             AS subreddit_shares
""").first().asDict()

dbutils.notebook.exit(json.dumps(counts))
