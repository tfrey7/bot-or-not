#!/usr/bin/env python3
# Print one value out of the JSON document on stdin. argv: a dotted path;
# integer segments index into lists ("0.id", "details.host").

import json
import sys


def main():
    value = json.load(sys.stdin)

    for segment in sys.argv[1].split("."):
        if isinstance(value, list):
            value = value[int(segment)]
        else:
            value = value[segment]

    print(value)


if __name__ == "__main__":
    main()
