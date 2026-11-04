#!/usr/bin/env bash
# Regenerate node/tests/fixtures/bmfont-packed.json from art_kit v0.10.0 and v0.5.0 with Pillow 13.0.0 in an
# offline python:3.12 container.
set -euo pipefail
[[ $# = 1 ]] || { echo 'Usage: bmfont-fixtures.sh <Pillow dependency directory>' >&2; exit 2; }
exec node "$(dirname -- "${BASH_SOURCE[0]}")/../../scripts/container.mts" bmfont-fixtures "$@"
