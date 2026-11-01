#!/usr/bin/env bash
# Build a committed wheel without package-registry publication.
set -euo pipefail
[[ $# = 2 ]] || { echo 'Usage: pack.sh <build-dependency-directory> <output-directory>' >&2; exit 2; }
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
build_deps=$(realpath "$1")
revision=$(git -C "$root" rev-parse HEAD)
source_epoch=$(git -C "$root" show -s --format=%ct "$revision")
check_load=$(cut -d ' ' -f 1 /proc/loadavg)
awk -v check_load="$check_load" 'BEGIN { exit !(check_load < 24) }' || { echo 'One-minute load must be below 24' >&2; exit 1; }
mkdir -p "$2" "$root/.claude"
output=$(realpath "$2")
# CLEANUP (added 2026-11-01): retain snapshots until their release artifacts are verified.
scratch=$(mktemp -d "$root/.claude/release.XXXXXXXX")
git -C "$root" archive "$revision" src pyproject.toml README.md LICENSE | tar -x -C "$scratch"
printf '%s\n' "$revision" > "$scratch/src/art_kit/SOURCE_COMMIT"
printf '/build-deps\n' > "$scratch/build.pth"
docker run --rm --read-only --network none --cpus 4 -u "$(id -u):$(id -g)" \
  --mount "type=bind,source=$scratch,target=/package" \
  --mount "type=bind,source=$build_deps,target=/build-deps,readonly" \
  --mount "type=bind,source=$scratch/build.pth,target=/usr/local/lib/python3.12/site-packages/art-build.pth,readonly" \
  --mount "type=bind,source=$output,target=/out" \
  --tmpfs "/tmp:exec,uid=$(id -u),gid=$(id -g)" \
  -e HOME=/tmp -e "SOURCE_DATE_EPOCH=$source_epoch" -w /package python:3.12 bash -ec '
    python -I -m pip wheel --no-build-isolation --no-deps --no-index /package --wheel-dir /out
    cp src/art_kit/SOURCE_COMMIT /out/SOURCE_COMMIT
    cd /out
    sha256sum art_kit-*.whl > SHA256SUMS
  '
echo "Release artifacts: $output"
