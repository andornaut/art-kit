#!/usr/bin/env bash
# Regenerates node/tests/fixtures/draw.json from Pillow 13.0.0 in an offline python:3.12 container.
set -euo pipefail
[[ $# = 1 ]] || { echo 'Usage: draw-fixtures.sh <Pillow dependency directory>' >&2; exit 2; }
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)
deps=$(realpath "$1")
# shellcheck source=scripts/container.sh
source "$root/scripts/container.sh"
require_idle
container_init art-kit-draw-fixtures none
readonly_mount "$root/node/tests" /tests
readonly_mount "$deps" /deps
docker run "${container_args[@]}" -e PYTHONDONTWRITEBYTECODE=1 -w /tmp python:3.12 bash -ec '
  umask 022
  # Isolated Python ignores PYTHONPATH, so a venv .pth file adds the read-only dependency path.
  python -I -m venv --system-site-packages --without-pip /tmp/venv
  printf "/deps\n" > /tmp/venv/lib/python3.12/site-packages/draw-deps.pth
  mkdir /tmp/out
  /tmp/venv/bin/python -I /tests/draw_fixtures.py /tmp/out/draw.json
'
docker cp "$container:/tmp/out/draw.json" "$root/node/tests/fixtures/draw.json"
