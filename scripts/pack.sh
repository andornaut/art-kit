#!/usr/bin/env bash
# Build a committed wheel without package-registry publication.
set -euo pipefail
[[ $# = 2 ]] || { echo 'Usage: pack.sh <build-dependency-directory> <output-directory>' >&2; exit 2; }
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
build_deps=$(realpath "$1")
# shellcheck source=scripts/container.sh
source "$root/scripts/container.sh"
require_idle
mkdir -p "$2"
output=$(realpath "$2")
[[ -z "$(find "$output" -mindepth 1 -maxdepth 1 -print -quit)" ]] || { echo 'Output directory must be empty' >&2; exit 1; }
guard_source "$root"
revision=$(git -C "$root" rev-parse HEAD)
source_epoch=$(git -C "$root" show -s --format=%ct "$revision")
container_init art-kit-pack none
readonly_mount "$build_deps" /build-deps
# The committed tree arrives on stdin and is extracted inside the container.
git -C "$root" archive "$revision" src pyproject.toml README.md LICENSE |
  docker run -i "${container_args[@]}" -e "REVISION=$revision" -e "SOURCE_DATE_EPOCH=$source_epoch" -w /tmp python:3.12 bash -ec '
    umask 022
    mkdir -p /tmp/package /tmp/out
    tar -x -C /tmp/package
    printf "%s\n" "$REVISION" > /tmp/package/src/art_kit/SOURCE_COMMIT
    python -I -m venv --system-site-packages --without-pip /tmp/venv
    printf "/build-deps\n" > /tmp/venv/lib/python3.12/site-packages/art-build.pth
    python=/tmp/venv/bin/python
    cd /tmp/package
    "$python" -I -c '\''import importlib.metadata as metadata
import re
import tomllib
from pathlib import Path

normalise = lambda name: re.sub(r"[-_.]+", "-", name).lower()
installed = {normalise(dist.metadata["Name"]): dist.version for dist in metadata.distributions(path=["/build-deps"])}
requirements = tomllib.loads(Path("pyproject.toml").read_text())["build-system"]["requires"]
for requirement in requirements:
    pin = re.fullmatch(r"([A-Za-z0-9_.-]+)==([^*<>=!~;\s]+)", requirement)
    if pin is None:
        raise SystemExit(f"Build dependency must use an exact version pin: {requirement}")
    name, expected = pin.groups()
    actual = installed.get(normalise(name), "missing")
    if actual != expected:
        raise SystemExit(f"Build dependency {name}: expected {expected}, actual {actual} in /build-deps")
'\''
    "$python" -I -m pip wheel --no-build-isolation --no-deps --no-index /tmp/package --wheel-dir /tmp/out
    cp src/art_kit/SOURCE_COMMIT /tmp/out/SOURCE_COMMIT
    cd /tmp/out
    "$python" -I -c '\''import glob, tomllib, zipfile
from email.parser import BytesParser
from pathlib import Path
version = tomllib.loads(Path("/tmp/package/pyproject.toml").read_text())["project"]["version"]
wheels = glob.glob("art_kit-*.whl")
assert wheels == [f"art_kit-{version}-py3-none-any.whl"], wheels
with zipfile.ZipFile(wheels[0]) as wheel:
    assert wheel.read("art_kit/SOURCE_COMMIT") == Path("SOURCE_COMMIT").read_bytes()
    metadata = BytesParser().parsebytes(wheel.read(f"art_kit-{version}.dist-info/METADATA"))
    assert metadata["Name"] == "art-kit" and metadata["Version"] == version
'\''
    sha256sum art_kit-*.whl SOURCE_COMMIT > SHA256SUMS
  '
docker cp "$container:/tmp/out/." "$output"
verify_source
echo "Release artifacts: $output"
