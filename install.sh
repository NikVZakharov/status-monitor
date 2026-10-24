#!/usr/bin/env bash
set -euo pipefail
script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec 9>/run/lock/status-monitor-install.lock
flock --exclusive 9
exec node "$script_directory/scripts/install.mjs" "$@"
