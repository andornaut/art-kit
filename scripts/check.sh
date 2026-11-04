#!/usr/bin/env bash
set -euo pipefail
[[ $# = 3 ]] || { echo 'Usage: check.sh <Pillow dependency directory> <Ruff binary> <build dependency directory>' >&2; exit 2; }
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
deps=$(realpath "$1")
ruff=$(realpath "$2")
build_deps=$(realpath "$3")
# shellcheck source=scripts/container.sh
source "$root/scripts/container.sh"
require_idle
mkdir -p "$root/.claude"
evidence=$(mktemp -d "$root/.claude/check.XXXXXXXX")
guard_source "$root"
container_init art-kit-check none
readonly_mount "$root" /app
readonly_mount "$deps" /deps
readonly_mount "$ruff" /ruff
readonly_mount "$build_deps" /build-deps
docker run "${container_args[@]}" -e PYTHONDONTWRITEBYTECODE=1 -w /app python:3.12 bash -ec '
  umask 022
  # Isolated Python ignores PYTHONPATH, so a venv .pth file adds the read-only dependency and source paths.
  python -I -m venv --system-site-packages --without-pip /tmp/venv
  printf "/deps\n/build-deps\n/app/src\n" > /tmp/venv/lib/python3.12/site-packages/art-kit.pth
  python=/tmp/venv/bin/python
  /ruff --version | grep -Fx "ruff 0.17.2"
  "$python" -I -c "import PIL; assert PIL.__version__ == '\''13.0.0'\''"
  /ruff check --no-cache .
  /ruff format --check --no-cache .
  "$python" -I -m unittest discover -s tests -v
  mkdir -p /tmp/package /tmp/out/wheels
  cp /app/pyproject.toml /app/README.md /app/LICENSE /tmp/package/
  cp -R /app/src /tmp/package/
  "$python" -I -m pip wheel --no-build-isolation --no-deps --no-index /tmp/package --wheel-dir /tmp/out/wheels
  "$python" -I -c "import importlib.metadata as m; print({p:m.version(p) for p in ['\''Pillow'\'','\''setuptools'\'','\''wheel'\'']})"
'
docker cp "$container:/tmp/out/." "$evidence"
verify_source
echo "Check evidence: $evidence"
