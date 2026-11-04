#!/usr/bin/env bash
# Compile, pack, install and test the Node package offline against the read-only checkout.
set -euo pipefail
[[ $# = 1 ]] || { echo 'Usage: check.sh <node_modules-directory>' >&2; exit 2; }
exec node "$(dirname -- "${BASH_SOURCE[0]}")/container.mts" check "$@"
