# Databricks pipeline

Medallion-architecture practice ground: loads Bot or Not backup exports into
Databricks and (eventually) derives coordination-network graphs from them.

- **Bronze** — raw export rows, one per user per snapshot, report payload as VARIANT.
- **Silver** — normalized tables: `users` (latest per user), `user_snapshots`
  (longitudinal), `factors`, `activity_events`, `report_events`.
- **Gold** — co-occurrence edge tables + graph metrics for ring discovery. (planned)

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
4. Run the `01_bronze_ingest` notebook in Databricks to (re)build `bronze.reports`.

The bronze rebuild is a full replace — fine at current export sizes; switching
to incremental Auto Loader ingestion is a future exercise.

## Files

- `prepare_export.py` — local reshape: export JSON object → JSONL lines.
- `ingest.sh` — catalog/schema/volume bootstrap + upload + notebook sync.
- `sql.sh` — shared warehouse lookup + `run_sql` helper (sourced, not run).
- `run_pipeline.sh` — full rebuild, bronze upward; the single pipeline entry
  point (new layers get added here).
- `rebuild_bronze.sh` / `rebuild_silver.sh` — headless table rebuilds + sanity
  counts via the SQL Statements API. Same SQL as the notebooks — keep in sync.
- `notebooks/` — interactive copies of the builds (`01_bronze_ingest`,
  `02_silver_build`).

The `load-export` Claude skill wraps the whole refresh (prepare → upload →
bronze → silver → sanity report) so a session can run it on request.
