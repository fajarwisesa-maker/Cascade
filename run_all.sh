#!/usr/bin/env bash
# Cross-platform runner is authoritative; this wrapper adds a full raw-data rebuild.
set -euo pipefail
cd "$(dirname "$0")"
exec python3 run_all.py --rebuild
