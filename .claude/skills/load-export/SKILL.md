---
name: load-export
description: Load the latest Bot or Not backup export into Databricks — prepare JSONL, upload to the bronze.raw volume, rebuild the bronze table, report sanity counts. Use when the user says "import the latest export", "load the export into Databricks", "refresh the Databricks data", or "time to import".
---

# Load the latest export into Databricks

End-to-end refresh of the Databricks bronze layer from a backup export. All
supporting scripts live in `databricks/` — see `databricks/README.md` for the
architecture (bronze accumulates snapshots; silver computes current state).

1. **Find the newest export**: `ls -t ~/Downloads/bot-or-not-backup-*.json | head -1`.
   Report its timestamp to the user. If `databricks/data/reports-<same stamp>.jsonl`
   already exists, this export was already prepared — tell the user and ask whether
   they meant to press Export on the reports page first for a fresher snapshot.
   (Loading the same file again is harmless — uploads overwrite by filename and the
   bronze rebuild reads the whole volume — just usually not what they wanted.)
2. **Prepare**: `python3 databricks/prepare_export.py` (reshapes to JSONL under
   `databricks/data/`; pass a path to load a specific older backup instead).
3. **Upload**: `./databricks/ingest.sh` — bootstraps catalog/schema/volume on first
   run, uploads the JSONL, syncs `databricks/notebooks/` into the workspace.
   - If it fails with an auth error, the CLI login has expired. Ask the user to run
     `! databricks auth login --host https://dbc-635c7a74-39c2.cloud.databricks.com`
     (interactive browser flow), then rerun the script.
4. **Run the pipeline**: `./databricks/run_pipeline.sh` — rebuilds every medallion
   layer from the volume upward (bronze, then silver, then any layers added
   later); each stage prints its sanity counts.
5. **Report** the sanity counts to the user, noting how many snapshots bronze now
   holds. If distinct-user count didn't grow versus the previous load, say so —
   that usually means the newest download predates the last load.

The catalog defaults to `bot_or_not`; all scripts honor `BON_CATALOG` if the user
wants a different one. Don't edit `updates.json`/`CHANGELOG.md`/versioning here —
this skill touches only Databricks, never the extension publish pipeline.
