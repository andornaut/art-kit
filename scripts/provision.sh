#!/usr/bin/env bash
# Download the pinned Node check dependencies into an empty output directory.
exec node "$(dirname -- "${BASH_SOURCE[0]}")/container.mts" provision "$@"
