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
[[ -z "$(find "$output" -mindepth 1 -maxdepth 1 -print -quit)" ]] || { echo 'Output directory must be empty' >&2; exit 1; }
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
    python -I -c '\''import importlib.metadata as metadata
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
    python -I -m pip wheel --no-build-isolation --no-deps --no-index /package --wheel-dir /out
    cp src/art_kit/SOURCE_COMMIT /out/SOURCE_COMMIT
    cd /out
    python -I -c '\''import glob, tomllib, zipfile
from email.parser import BytesParser
from pathlib import Path
version = tomllib.loads(Path("/package/pyproject.toml").read_text())["project"]["version"]
wheels = glob.glob("art_kit-*.whl")
assert wheels == [f"art_kit-{version}-py3-none-any.whl"], wheels
with zipfile.ZipFile(wheels[0]) as wheel:
    assert wheel.read("art_kit/SOURCE_COMMIT") == Path("SOURCE_COMMIT").read_bytes()
    metadata = BytesParser().parsebytes(wheel.read(f"art_kit-{version}.dist-info/METADATA"))
    assert metadata["Name"] == "art-kit" and metadata["Version"] == version
'\''
    sha256sum art_kit-*.whl SOURCE_COMMIT > SHA256SUMS
  '
echo "Release artifacts: $output"
