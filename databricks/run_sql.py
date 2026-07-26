#!/usr/bin/env python3
# Execute one SQL statement via the SQL Statements API and print any
# result rows. argv: statement, warehouse id. Exits non-zero when the
# statement doesn't reach SUCCEEDED.

import json
import subprocess
import sys


def main():
    statement, warehouse_id = sys.argv[1], sys.argv[2]

    payload = {
        "statement": statement,
        "warehouse_id": warehouse_id,
        "wait_timeout": "50s",
    }
    completed = subprocess.run(
        ["databricks", "api", "post", "/api/2.0/sql/statements", "--json", json.dumps(payload)],
        stdout=subprocess.PIPE,
        text=True,
        check=True,
    )
    response = json.loads(completed.stdout)

    state = response["status"]["state"]
    if state != "SUCCEEDED":
        sys.exit(f"SQL statement {state}: " + json.dumps(response.get("status"), indent=2))

    result = response.get("result")
    if result and "data_array" in result:
        columns = [c["name"] for c in response["manifest"]["schema"]["columns"]]
        for row in result["data_array"]:
            for name, value in zip(columns, row):
                print(f"  {name}: {value}")


if __name__ == "__main__":
    main()
