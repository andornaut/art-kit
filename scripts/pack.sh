#!/usr/bin/env bash
# Build the committed Node tarball, SOURCE_COMMIT and SHA256SUMS offline into an empty output directory.
set -euo pipefail
[[ $# = 2 ]] || { echo 'Usage: pack.sh <node_modules-directory> <output-directory>' >&2; exit 2; }
exec node "$(dirname -- "${BASH_SOURCE[0]}")/container.mts" pack "$@"
