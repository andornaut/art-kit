#!/usr/bin/env bash
set -euo pipefail
[[ $# = 1 ]] || { echo 'Usage: check-node.sh <node_modules-directory>' >&2; exit 2; }
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
deps=$(realpath "$1")
check_load=$(cut -d ' ' -f 1 /proc/loadavg)
awk -v check_load="$check_load" 'BEGIN { exit !(check_load < 24) }' || { echo 'One-minute load must be below 24' >&2; exit 1; }
mkdir -p "$root/.claude"
scratch=$(mktemp -d "$root/.claude/node.XXXXXXXX")
fingerprint() {
  { git -C "$root" status --porcelain=v1 -z; git -C "$root" ls-files --cached --others --exclude-standard -z | sort -z | while IFS= read -r -d '' path; do sha256sum "$root/$path"; done; } | sha256sum
}
before=$(fingerprint)
finish() {
  result=$?
  trap - EXIT
  [[ "$before" = "$(fingerprint)" ]] || { echo 'Source changed; discard check result' >&2; exit 1; }
  exit "$result"
}
trap finish EXIT
mkdir -p "$scratch/source"
revision=$(git -C "$root" rev-parse HEAD)
cp -R "$root/node" "$root/scripts" "$root/pyproject.toml" "$root/LICENSE" "$scratch/source/"
docker run --rm --read-only --network none --cpus 4 -u "$(id -u):$(id -g)" \
  --mount "type=bind,source=$scratch,target=/work" \
  --mount "type=bind,source=$deps,target=/deps,readonly" \
  --tmpfs "/tmp:exec,uid=$(id -u),gid=$(id -g)" \
  -e HOME=/tmp -e npm_config_cache=/tmp/npm-cache \
  -e ART_KIT_TEST_FONTS=/work/source/node/tests/fixtures \
  -w /work node:24.21.0 node /work/source/scripts/node-package.mjs check "$revision"
echo "Node evidence: $scratch"
