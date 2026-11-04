#!/usr/bin/env bash
# Download the pinned Python and Node check dependencies into an empty output directory.
set -euo pipefail
[[ $# = 1 ]] || { echo 'Usage: provision.sh <output-directory>' >&2; exit 2; }
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
# shellcheck source=scripts/container.sh
source "$root/scripts/container.sh"
require_idle
mkdir -p "$1"
output=$(realpath "$1")
[[ -z "$(find "$output" -mindepth 1 -maxdepth 1 -print -quit)" ]] || { echo 'Output directory must be empty' >&2; exit 1; }
container_init art-kit-provision-python bridge
docker run "${container_args[@]}" -w /tmp python:3.12 \
  python -I -m pip install --no-cache-dir --target /tmp/python Pillow==13.0.0 ruff==0.17.2 setuptools==84.2.1 wheel==0.48.0
docker cp "$container:/tmp/python" "$output/python"
container_cleanup
container_init art-kit-provision-node bridge
readonly_mount "$root/node/package.json" /descriptor.json
docker run "${container_args[@]}" -w /tmp node:24.21.0 bash -ec '
  umask 022
  mkdir /tmp/tools
  cd /tmp/tools
  node --input-type=module -e '\''import {readFileSync,writeFileSync} from "node:fs"; const p=JSON.parse(readFileSync("/descriptor.json")); writeFileSync("package.json", JSON.stringify({private:true,dependencies:{...p.devDependencies,...p.peerDependencies}}))'\''
  npm install --ignore-scripts --no-audit --no-fund --cache /tmp/npm-cache
  (cd node_modules/skia-canvas && node lib/prebuild.mjs download)
'
mkdir "$output/node"
docker cp "$container:/tmp/tools/node_modules" "$output/node/node_modules"
echo "Dependencies: $output/python and $output/node/node_modules"
