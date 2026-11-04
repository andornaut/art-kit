#!/usr/bin/env bash
# Lint, test and build the wheel offline against the read-only checkout.
set -euo pipefail
[[ $# = 3 ]] || { echo 'Usage: check.sh <Pillow dependency directory> <Ruff binary> <build dependency directory>' >&2; exit 2; }
exec node "$(dirname -- "${BASH_SOURCE[0]}")/container.mts" check "$@"
