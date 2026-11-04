#!/usr/bin/env bash
set -euo pipefail
[[ $# = 2 ]] || { echo 'Usage: pack-node.sh <node_modules-directory> <output-directory>' >&2; exit 2; }
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
deps=$(realpath "$1")
output=$(realpath "$2")
# shellcheck source=scripts/container.sh
source "$root/scripts/container.sh"
require_idle
guard_source "$root"
revision=$(git -C "$root" rev-parse HEAD)
version=$(git -C "$root" show "$revision:pyproject.toml" | sed -n 's/^version = "\([^"]*\)"$/\1/p')
[[ -n "$version" ]] || { echo 'Missing project version' >&2; exit 1; }
container_init art-kit-pack-node none
readonly_mount "$deps" /deps
readonly_mount "$output" /release
# The committed tree arrives on stdin; the existing release files are copied in from the read-only mount.
git -C "$root" archive "$revision" node scripts/node-package.mjs pyproject.toml LICENSE |
  docker run -i "${container_args[@]}" -e "REVISION=$revision" -e npm_config_cache=/tmp/npm-cache -w /tmp node:24.21.0 bash -ec '
    umask 022
    mkdir -p /tmp/work/source /tmp/out
    tar -x -C /tmp/work/source
    cp -R /release/. /tmp/out/
    exec node /tmp/work/source/scripts/node-package.mjs pack "$REVISION"
  '
docker cp "$container:/tmp/out/art-kit-$version.tgz" "$output/art-kit-$version.tgz"
docker cp "$container:/tmp/out/SHA256SUMS" "$output/SHA256SUMS"
verify_source
echo "Release artifacts: $output"
