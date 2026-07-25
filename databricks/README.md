# Databricks pipeline

Medallion-architecture practice ground: loads Bot or Not backup exports into
Databricks and (eventually) derives coordination-network graphs from them.

- **Bronze** — raw export rows, one per user, report payload as VARIANT.
- **Silver** — normalized tables: `users`, `verdicts`, `factors`, `activity_events`, `report_events`. (planned)
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
- `rebuild_bronze.sh` — headless `bronze.reports` rebuild + sanity counts via the
  SQL Statements API. Same CTAS as the notebook — keep the two in sync.
- `notebooks/01_bronze_ingest.py` — interactive copy of the bronze build.

The `load-export` Claude skill wraps steps 1–4 (prepare → upload → rebuild →
sanity report) so a session can run the whole refresh on request.
