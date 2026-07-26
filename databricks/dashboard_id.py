#!/usr/bin/env python3
# Print the dashboard_id of the dashboard whose display_name matches
# argv[1], reading `databricks lakeview list --output json` on stdin.
# Prints nothing when no dashboard matches.

import json
import sys


def main():
    dashboards = json.load(sys.stdin)
    matches = [d for d in dashboards if d.get("display_name") == sys.argv[1]]

    if matches:
        print(matches[0]["dashboard_id"])


if __name__ == "__main__":
    main()
