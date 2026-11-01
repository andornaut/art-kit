#!/usr/bin/env bash
set -euo pipefail
check=false
if [[ ${1:-} = --check ]]; then check=true; shift; fi
[[ $# = 1 ]] || { echo 'Usage: sync-into.sh [--check] <consumer>' >&2; exit 2; }
kit_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
consumer=$(cd -- "$1" && pwd -P)
revision=$(git -C "$kit_root" rev-parse HEAD)
scratch=$(mktemp -d)
trap 'find "$scratch" -type f -delete; find "$scratch" -depth -type d -empty -delete' EXIT
git -C "$kit_root" archive "$revision" -- LICENSE README.md pyproject.toml ruff.toml src | tar -x -C "$scratch"
printf '%s\n' "$revision" > "$scratch/ART_KIT_COMMIT"
python3 "$kit_root/scripts/vendor.py" "$check" "$scratch" "$consumer/vendor/art-kit"
