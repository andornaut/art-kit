#!/usr/bin/env bash
# Install the released wheel into an isolated venv and verify its imports, version and source identity.
set -euo pipefail
[[ $# = 3 ]] || { echo 'Usage: verify-wheel.sh <Pillow dependency directory> <release directory> <expected commit>' >&2; exit 2; }
exec node "$(dirname -- "${BASH_SOURCE[0]}")/container.mts" verify-wheel "$@"
