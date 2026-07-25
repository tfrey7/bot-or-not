# Databricks pipeline

Medallion-architecture practice ground: loads Bot or Not backup exports into
Databricks and (eventually) derives coordination-network graphs from them.

- **Bronze** — raw export rows, one per user per snapshot, report payload as VARIANT.
- **Silver** — normalized tables: `users` (latest per user), `user_snapshots`
  (longitudinal), `factors`, `activity_events`, `report_events`.
- **Gold** — coordination-network features: `subreddit_fingerprints` (TF-IDF
  attention vectors). Planned: similarity edges, ring candidates.

## One-time setup

```
databricks auth login --host https://dbc-635c7a74-39c2.cloud.databricks.com
```

## Load an export

1. Export a backup from the reports page (lands in `~/Downloads/bot-or-not-backup-*.json`).
2. `python3 databricks/prepare_export.py` — reshapes the newest backup into
   JSONL under `databricks/data/` (gitignored). Pass a path to use a specific backup.
3. `./databricks/ingest.sh` — creates catalog `bot_or_not` (override with
   `BON_CATALOG`, e.g. if the workspace disallows catalog creation), uploads the
   JSONL to the `bronze.raw` volume, and syncs `notebooks/` into the workspace.
4. `./databricks/run_pipeline.sh` — rebuilds the tables bronze → silver → gold.

Bronze ingestion is incremental: `COPY INTO` tracks which volume files
`bronze.reports` has already loaded, so each run parses only newly uploaded
snapshots. `DROP TABLE bronze.reports` and rerun to force a full re-ingest.
Silver and gold are full rebuilds from bronze; the five silver tables build
concurrently.

## Files

- `prepare_export.py` — local reshape: export JSON object → JSONL lines.
- `ingest.sh` — catalog/schema/volume bootstrap + JSONL upload.
- `sql.sh` — shared warehouse lookup + `run_sql` helper for the bootstrap DDL
  (sourced, not run).
- `run_pipeline.sh` — the single pipeline entry point: syncs `notebooks/` into
  the workspace and submits a one-off Databricks job run with one task per
  layer (bronze → silver → gold). New layers get added as tasks here.
- `notebooks/` — the **canonical** transformation code (`01_bronze_ingest`,
  `02_silver_build`, `03_gold_build`). Each notebook ends with `dbutils.notebook.exit(...)`
  returning its sanity counts to the pipeline runner; the same notebooks are
  runnable interactively in the workspace.

The `load-export` Claude skill wraps the whole refresh (prepare → upload →
bronze → silver → sanity report) so a session can run it on request.
