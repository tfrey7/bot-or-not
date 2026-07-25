# Sourced by ingest.sh / rebuild_*.sh: resolves the SQL warehouse and
# provides run_sql, which executes one statement via the SQL Statements
# API and prints any result rows.

WAREHOUSE_ID="$(databricks warehouses list --output json | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['id'])")"

run_sql() {
  databricks api post /api/2.0/sql/statements --json "$(python3 -c "
import json, sys
print(json.dumps({'statement': sys.argv[1], 'warehouse_id': sys.argv[2], 'wait_timeout': '50s'}))
" "$1" "$WAREHOUSE_ID")" | python3 -c "
import json, sys
response = json.load(sys.stdin)
state = response['status']['state']
if state != 'SUCCEEDED':
    sys.exit(f'SQL statement {state}: ' + json.dumps(response.get('status'), indent=2))
result = response.get('result')
if result and 'data_array' in result:
    columns = [c['name'] for c in response['manifest']['schema']['columns']]
    for row in result['data_array']:
        for name, value in zip(columns, row):
            print(f'  {name}: {value}')
"
}
