#!/usr/bin/env bash
# Add the committed Node tarball to the pack.sh output and recompute SHA256SUMS.
set -euo pipefail
[[ $# = 2 ]] || { echo 'Usage: pack-node.sh <node_modules-directory> <output-directory>' >&2; exit 2; }
exec node "$(dirname -- "${BASH_SOURCE[0]}")/container.mts" pack-node "$@"
