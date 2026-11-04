#!/usr/bin/env bash
# Regenerates node/tests/fixtures/bmfont-packed.json from art_kit v0.10.0 and v0.5.0 with Pillow 13.0.0 in an
# offline python:3.12 container.
set -euo pipefail
[[ $# = 1 ]] || { echo 'Usage: bmfont-fixtures.sh <Pillow dependency directory>' >&2; exit 2; }
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)
deps=$(realpath "$1")
# shellcheck source=scripts/container.sh
source "$root/scripts/container.sh"
require_idle
mkdir -p "$root/.claude"
references=$(mktemp -d "$root/.claude/bmfont-references.XXXXXXXX")
chmod 755 "$references"
git -C "$root" show v0.10.0:src/art_kit/fonts.py > "$references/fonts_v0100.py"
git -C "$root" show v0.5.0:src/art_kit/fonts.py > "$references/fonts_v050.py"
chmod 644 "$references"/*.py
container_init art-kit-bmfont-fixtures none
readonly_mount "$root/node/tests" /tests
readonly_mount "$references" /references
readonly_mount "$deps" /deps
docker run "${container_args[@]}" -e PYTHONDONTWRITEBYTECODE=1 -w /tmp python:3.12 bash -ec '
  umask 022
  # Isolated Python ignores PYTHONPATH, so a venv .pth file adds the read-only dependency path.
  python -I -m venv --system-site-packages --without-pip /tmp/venv
  printf "/deps\n" > /tmp/venv/lib/python3.12/site-packages/bmfont-deps.pth
  mkdir /tmp/out
  /tmp/venv/bin/python -I /tests/bmfont_fixtures.py /references /tests/fixtures /tmp/out/bmfont-packed.json
'
docker cp "$container:/tmp/out/bmfont-packed.json" "$root/node/tests/fixtures/bmfont-packed.json"
rm -r "$references"
