#!/usr/bin/env bash
# Pillow 13.0.0 references for the GIF and ICO encoders, run under the shared container policy.
# generate: rewrites pillow.json from Pillow's decodes of its own saves.
# crosscheck: encodes the fixture inputs with the current Node source and compares Pillow's decodes.
# <provision-directory> is the output of scripts/provision.sh.
set -euo pipefail
[[ $# = 2 && ($1 = generate || $1 = crosscheck) ]] || { echo 'Usage: pillow.sh <generate|crosscheck> <provision-directory>' >&2; exit 2; }
mode=$1
here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
root=$(cd -- "$here/../../../.." && pwd -P)
deps=$(realpath "$2")
fixture=/app/node/tests/fixtures/gif-ico
reference=/app/tests/gif_ico_reference.py
# shellcheck source=scripts/container.sh
source "$root/scripts/container.sh"
require_idle

python_args() {
  readonly_mount "$root" /app
  readonly_mount "$deps/python" /deps
  container_args+=(-e PYTHONPATH=/deps -e PYTHONDONTWRITEBYTECODE=1 -w /tmp)
}

if [[ $mode = generate ]]; then
  container_init art-kit-pillow-generate none
  python_args
  docker run "${container_args[@]}" python:3.12 python "$reference" generate /tmp/pillow.json
  docker cp "$container:/tmp/pillow.json" "$here/pillow.json"
  echo "Generated: $here/pillow.json"
  exit 0
fi

guard_source "$root"
mkdir -p "$root/.claude"
encoded=$(mktemp -d "$root/.claude/pillow.XXXXXXXX")
container_init art-kit-pillow-encode none
readonly_mount "$root" /app
readonly_mount "$deps/node/node_modules" /deps
docker run "${container_args[@]}" -w /tmp node:24.21.0 bash -ec "
  umask 022
  mkdir /tmp/src
  cp -R /app/node/src /app/node/tsconfig.json /app/node/package.json /tmp/src/
  ln -s /deps /tmp/src/node_modules
  node /deps/typescript/bin/tsc -p /tmp/src/tsconfig.json
  node $fixture/encode.mjs /tmp/src/dist $fixture/pillow.json /tmp/out
"
docker cp "$container:/tmp/out/." "$encoded"
chmod -R g+rX "$encoded"
container_cleanup
container_init art-kit-pillow-crosscheck none
python_args
readonly_mount "$encoded" /encoded
docker run "${container_args[@]}" python:3.12 python "$reference" crosscheck "$fixture/pillow.json" /encoded
echo "Encoded: $encoded"
