#!/usr/bin/env bash
# Full medallion rebuild, bronze upward, as a one-off Databricks job run.
# The notebooks in notebooks/ are the canonical transformation code: this
# script syncs them into the workspace and submits a run with one task per
# layer (bronze -> silver). Add new layers as tasks here, not as scripts.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CATALOG="${BON_CATALOG:-bot_or_not}"

USER_NAME="$(databricks current-user me --output json | python3 -c "import json,sys; print(json.load(sys.stdin)['userName'])")"
WORKSPACE_DIR="/Workspace/Users/$USER_NAME/bot-or-not"

databricks workspace import-dir "$SCRIPT_DIR/notebooks" "$WORKSPACE_DIR" --overwrite > /dev/null
echo "Notebooks synced to $WORKSPACE_DIR"

SUBMIT_JSON="$(python3 -c "
import json, sys
workspace_dir, catalog = sys.argv[1], sys.argv[2]

def task(key, notebook, depends_on=None):
    spec = {
        'task_key': key,
        'notebook_task': {
            'notebook_path': f'{workspace_dir}/{notebook}',
            'base_parameters': {'catalog': catalog},
        },
    }
    if depends_on:
        spec['depends_on'] = [{'task_key': depends_on}]
    return spec

print(json.dumps({
    'run_name': 'bot-or-not medallion rebuild',
    'tasks': [
        task('bronze', '01_bronze_ingest'),
        task('silver', '02_silver_build', depends_on='bronze'),
        task('gold', '03_gold_build', depends_on='silver'),
    ],
}))
" "$WORKSPACE_DIR" "$CATALOG")"

echo "Submitting job run (catalog $CATALOG)..."
set +e
SUBMIT_OUT="$(databricks jobs submit --json "$SUBMIT_JSON" --output json 2>&1)"
set -e

RUN_ID="$(echo "$SUBMIT_OUT" | python3 -c "
import json, sys
try:
    print(json.load(sys.stdin)['run_id'])
except Exception:
    print('')
")"
if [ -z "$RUN_ID" ]; then
  # The CLI exits with only an error message when a waited-on run fails;
  # recover the run via the runs list so we can still report per-task errors.
  RUN_ID="$(databricks jobs list-runs --output json | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['run_id'])")"
fi

databricks jobs get-run "$RUN_ID" --output json | python3 -c "
import json, subprocess, sys

def run_output(task_run_id):
    return json.loads(subprocess.run(
        ['databricks', 'jobs', 'get-run-output', str(task_run_id), '--output', 'json'],
        capture_output=True, text=True, check=True,
    ).stdout)

run = json.load(sys.stdin)
failed = False
for task in run['tasks']:
    result_state = task['state'].get('result_state')
    if result_state == 'SUCCESS':
        print(f\"{task['task_key']} rebuilt:\")
        result = run_output(task['run_id']).get('notebook_output', {}).get('result')
        if result:
            for name, value in json.loads(result).items():
                print(f'  {name}: {value}')
    else:
        failed = True
        print(f\"{task['task_key']}: {result_state}\")
        error = run_output(task['run_id']).get('error')
        if error:
            print(f'  {error}')

print('Run page:', run['run_page_url'])
if failed:
    sys.exit(1)
"
