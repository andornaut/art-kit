#!/usr/bin/env bash
set -euo pipefail
[[ $# = 1 ]] || { echo 'Usage: check-node.sh <node_modules-directory>' >&2; exit 2; }
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
deps=$(realpath "$1")
# shellcheck source=scripts/container.sh
source "$root/scripts/container.sh"
require_idle
mkdir -p "$root/.claude"
evidence=$(mktemp -d "$root/.claude/node.XXXXXXXX")
guard_source "$root"
revision=$(git -C "$root" rev-parse HEAD)
container_init art-kit-node none
readonly_mount "$root" /app
readonly_mount "$deps" /deps
docker run "${container_args[@]}" -e "REVISION=$revision" -e npm_config_cache=/tmp/npm-cache \
  -e ART_KIT_TEST_FONTS=/tmp/work/source/node/tests/fixtures -w /tmp node:24.21.0 bash -ec '
  umask 022
  mkdir -p /tmp/work/source /tmp/out
  cp -R /app/node /app/scripts /app/pyproject.toml /app/LICENSE /tmp/work/source/
  exec node /tmp/work/source/scripts/node-package.mjs check "$REVISION"
'
docker cp "$container:/tmp/out/." "$evidence"
verify_source
echo "Node evidence: $evidence"
