#!/usr/bin/env bash
# Install the released wheel into an isolated venv and verify its imports, version and source identity.
set -euo pipefail
[[ $# = 3 ]] || { echo 'Usage: verify-wheel.sh <Pillow dependency directory> <release directory> <expected commit>' >&2; exit 2; }
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
deps=$(realpath "$1")
release=$(realpath "$2")
# shellcheck source=scripts/container.sh
source "$root/scripts/container.sh"
require_idle
guard_source "$root"
container_init art-kit-verify-wheel none
readonly_mount "$root/pyproject.toml" /pyproject.toml
readonly_mount "$release" /release
readonly_mount "$deps" /deps
docker run "${container_args[@]}" -e "EXPECTED_COMMIT=$3" -w /tmp python:3.12 bash -ec '
  EXPECTED_VERSION=$(python -I -c '\''import tomllib; print(tomllib.load(open("/pyproject.toml", "rb"))["project"]["version"])'\'')
  export EXPECTED_VERSION
  cd /release
  sha256sum --check SHA256SUMS
  test "$(cat SOURCE_COMMIT)" = "$EXPECTED_COMMIT"
  python -I -m venv /tmp/venv
  /tmp/venv/bin/python -I -m pip install --no-index --no-deps /release/art_kit-*.whl
  printf "/deps\n" > /tmp/venv/lib/python3.12/site-packages/pillow.pth
  /tmp/venv/bin/python -I -c "import importlib.metadata as m, os, pathlib, sys; import art_kit; from art_kit import aseprite, colour, fonts, frames, grid; import PIL; package = pathlib.Path(art_kit.__file__).resolve().parent; assert package.is_relative_to(pathlib.Path(sys.prefix)); assert (package / '\''SOURCE_COMMIT'\'').read_text().strip() == os.environ['\''EXPECTED_COMMIT'\'']; assert m.version('\''art-kit'\'') == os.environ['\''EXPECTED_VERSION'\'']; assert PIL.__version__ == '\''13.0.0'\''"
'
verify_source
echo "Verified wheel: $release"
