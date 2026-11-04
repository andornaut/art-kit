#!/usr/bin/env bash
# Regenerate node/tests/fixtures/draw.json from Pillow 13.0.0 in an offline python:3.12 container.
set -euo pipefail
[[ $# = 1 ]] || { echo 'Usage: draw-fixtures.sh <Pillow dependency directory>' >&2; exit 2; }
exec node "$(dirname -- "${BASH_SOURCE[0]}")/../../scripts/container.mts" draw-fixtures "$@"
