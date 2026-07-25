#!/usr/bin/env python3
# Reshape a Bot or Not backup export (one giant JSON object keyed by
# username) into JSONL (one line per user), which Spark can ingest and
# parallelize. Output lands in databricks/data/ (gitignored).

import glob
import json
import os
import sys


def newest_backup():
    candidates = glob.glob(os.path.expanduser("~/Downloads/bot-or-not-backup-*.json"))
    if not candidates:
        sys.exit("No ~/Downloads/bot-or-not-backup-*.json found. Export one from the reports page first.")
    return max(candidates, key=os.path.getmtime)


def main():
    source = sys.argv[1] if len(sys.argv) > 1 else newest_backup()

    with open(source) as f:
        backup = json.load(f)

    if "bonBackup" not in backup:
        sys.exit(f"{source} is not a Bot or Not backup (missing bonBackup marker).")

    stamp = os.path.basename(source).removeprefix("bot-or-not-backup-").removesuffix(".json")
    out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, f"reports-{stamp}.jsonl")

    count = 0
    with open(out_path, "w") as out:
        for username, report in backup["reports"].items():
            line = {
                "username": username,
                "exported_at": backup["exportedAt"],
                "app_version": backup["appVersion"],
                "report": report,
            }
            out.write(json.dumps(line, separators=(",", ":")) + "\n")
            count += 1

    print(f"{source} -> {out_path} ({count} users)")


if __name__ == "__main__":
    main()
