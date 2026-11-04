#!/usr/bin/env bash
# Build the committed Node tarball, SOURCE_COMMIT and SHA256SUMS offline into an empty output directory.
exec node "$(dirname -- "${BASH_SOURCE[0]}")/container.mts" pack "$@"
