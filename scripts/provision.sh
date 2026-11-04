#!/usr/bin/env bash
# Download the pinned Node check dependencies into an empty output directory.
set -euo pipefail
[[ $# = 1 ]] || { echo 'Usage: provision.sh <output-directory>' >&2; exit 2; }
exec node "$(dirname -- "${BASH_SOURCE[0]}")/container.mts" provision "$@"
