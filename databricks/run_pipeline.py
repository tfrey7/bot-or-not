#!/usr/bin/env python3
# Full medallion rebuild, bronze upward, as a one-off Databricks job run.
# The notebooks in notebooks/ are the canonical transformation code: this
# script syncs them into the workspace and submits a run with one task per
# layer (bronze -> silver -> gold). Add new layers as tasks here, not as
# scripts.

import json
import os
import subprocess
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent


def databricks(*args):
    completed = subprocess.run(
        ["databricks", *args], capture_output=True, text=True, check=True
    )
    return completed.stdout


def databricks_json(*args):
    return json.loads(databricks(*args, "--output", "json"))


def notebook_task(key, notebook, workspace_dir, catalog, depends_on=None):
    spec = {
        "task_key": key,
        "notebook_task": {
            "notebook_path": f"{workspace_dir}/{notebook}",
            "base_parameters": {"catalog": catalog},
        },
    }
    if depends_on:
        spec["depends_on"] = [{"task_key": depends_on}]
    return spec


def submit_run(workspace_dir, catalog):
    submit_spec = {
        "run_name": "bot-or-not medallion rebuild",
        "tasks": [
            notebook_task("bronze", "01_bronze_ingest", workspace_dir, catalog),
            notebook_task(
                "silver", "02_silver_build", workspace_dir, catalog, depends_on="bronze"
            ),
            notebook_task(
                "gold", "03_gold_build", workspace_dir, catalog, depends_on="silver"
            ),
        ],
    }

    try:
        submitted = databricks_json("jobs", "submit", "--json", json.dumps(submit_spec))
        return submitted["run_id"]
    except subprocess.CalledProcessError:
        # The CLI exits with only an error message when a waited-on run fails;
        # recover the run via the runs list so we can still report per-task errors.
        return databricks_json("jobs", "list-runs")[0]["run_id"]


def report_run(run_id):
    run = databricks_json("jobs", "get-run", str(run_id))

    failed = False
    for task in run["tasks"]:
        result_state = task["state"].get("result_state")
        output = databricks_json("jobs", "get-run-output", str(task["run_id"]))

        if result_state == "SUCCESS":
            print(f"{task['task_key']} rebuilt:")
            result = output.get("notebook_output", {}).get("result")
            if result:
                for name, value in json.loads(result).items():
                    print(f"  {name}: {value}")
        else:
            failed = True
            print(f"{task['task_key']}: {result_state}")
            error = output.get("error")
            if error:
                print(f"  {error}")

    print("Run page:", run["run_page_url"])
    return failed


def main():
    catalog = os.environ.get("BON_CATALOG", "bot_or_not")
    user_name = databricks_json("current-user", "me")["userName"]
    workspace_dir = f"/Workspace/Users/{user_name}/bot-or-not"

    databricks(
        "workspace", "import-dir", str(SCRIPT_DIR / "notebooks"), workspace_dir, "--overwrite"
    )
    print(f"Notebooks synced to {workspace_dir}")

    print(f"Submitting job run (catalog {catalog})...")
    run_id = submit_run(workspace_dir, catalog)

    if report_run(run_id):
        sys.exit(1)


if __name__ == "__main__":
    main()
