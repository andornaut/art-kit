#!/usr/bin/env bash
# Regenerates node/tests/fixtures/draw.json from Pillow 13.0.0 in an offline python:3.12 container.
# Inputs are copied in and the result copied out, so the container mounts nothing from the host.
set -euo pipefail
[[ $# = 1 ]] || { echo 'Usage: draw-fixtures.sh <Pillow dependency directory>' >&2; exit 2; }
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)
deps=$(realpath "$1")
check_load=$(cut -d ' ' -f 1 /proc/loadavg)
awk -v check_load="$check_load" 'BEGIN { exit !(check_load < 24) }' || { echo 'One-minute load must be below 24' >&2; exit 1; }
name="art-kit-draw-fixtures-$$"
trap 'docker rm -f "$name" >/dev/null 2>&1 || true' EXIT
docker create --name "$name" --network none --cpus 4 --user 19001:19001 -e HOME=/tmp -e PYTHONDONTWRITEBYTECODE=1 \
  python:3.12 python -I /work/draw_fixtures.py /tmp/draw.json >/dev/null
tar -C "$deps" -c --owner=0 --group=0 --mode=a+rX . | docker cp - "$name:/usr/local/lib/python3.12/site-packages"
tar -C "$root/node/tests" -c --owner=0 --group=0 --mode=a+rX --transform 's,^,work/,' draw_fixtures.py | docker cp - "$name:/"
docker start -a "$name"
docker cp "$name:/tmp/draw.json" - | tar -xO > "$root/node/tests/fixtures/draw.json"
