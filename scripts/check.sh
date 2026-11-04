#!/usr/bin/env bash
# Compile, pack, install and test the Node package offline against the read-only checkout.
exec node "$(dirname -- "${BASH_SOURCE[0]}")/container.mts" check "$@"
