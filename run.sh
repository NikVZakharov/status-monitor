#!/usr/bin/env bash
set -euo pipefail
umask 077
script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[[ "${STATUS_STATE_DIRECTORY:-}" == /* && -d "$STATUS_STATE_DIRECTORY" ]] || { echo "Absolute existing state directory required." >&2; exit 1; }
command -v flock >/dev/null || { echo "util-linux flock is required." >&2; exit 1; }
exec flock --nonblock --no-fork --conflict-exit-code 73 "$STATUS_STATE_DIRECTORY/monitor.lock" \
  /usr/bin/env STATUS_MONITOR_LOCKED=1 node "$script_directory/src/monitor.mjs"
