#!/usr/bin/env bash
# Build the committed wheel offline without package-registry publication.
set -euo pipefail
[[ $# = 2 ]] || { echo 'Usage: pack.sh <build-dependency-directory> <output-directory>' >&2; exit 2; }
exec node "$(dirname -- "${BASH_SOURCE[0]}")/container.mts" pack "$@"
