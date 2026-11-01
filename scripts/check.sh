#!/usr/bin/env bash
set -euo pipefail
[[ $# = 3 ]] || { echo 'Usage: check.sh <Pillow dependency directory> <Ruff binary> <build dependency directory>' >&2; exit 2; }
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
deps=$(realpath "$1")
ruff=$(realpath "$2")
build_deps=$(realpath "$3")
check_load=$(cut -d ' ' -f 1 /proc/loadavg)
awk -v check_load="$check_load" 'BEGIN { exit !(check_load < 24) }' || { echo 'One-minute load must be below 24' >&2; exit 1; }
mkdir -p "$root/.claude"
scratch=$(mktemp -d "$root/.claude/check.XXXXXXXX")
# The .pth is explicit and mounted read-only because isolated Python ignores PYTHONPATH.
printf '/deps\n/build-deps\n' > "$scratch/art-deps.pth"
printf '/app/src\n' > "$scratch/art-kit.pth"
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
docker run --rm --read-only --network none --cpus 4 -u "$(id -u):$(id -g)" \
  --mount "type=bind,source=$root,target=/app,readonly" \
  --mount "type=bind,source=$deps,target=/deps,readonly" \
  --mount "type=bind,source=$ruff,target=/ruff,readonly" \
  --mount "type=bind,source=$build_deps,target=/build-deps,readonly" \
  --mount "type=bind,source=$scratch/art-deps.pth,target=/usr/local/lib/python3.12/site-packages/art-deps.pth,readonly" \
  --mount "type=bind,source=$scratch/art-kit.pth,target=/usr/local/lib/python3.12/site-packages/art-kit.pth,readonly" \
  --mount "type=bind,source=$scratch,target=/scratch" \
  --tmpfs "/tmp:exec,uid=$(id -u),gid=$(id -g)" \
  -e PYTHONDONTWRITEBYTECODE=1 -w /app python:3.12 bash -ec '
    /ruff --version | grep -Fx "ruff 0.17.2"
    python -I -c "import PIL; assert PIL.__version__ == '\''13.0.0'\''"
    /ruff check --no-cache .
    /ruff format --check --no-cache .
    python -I -m unittest discover -s tests -v
    mkdir -p /scratch/package
    cp /app/pyproject.toml /app/README.md /app/LICENSE /scratch/package/
    cp -R /app/src /scratch/package/
    python -I -m pip wheel --no-build-isolation --no-deps --no-index /scratch/package --wheel-dir /scratch/wheels
    python -I -c "import importlib.metadata as m; print({p:m.version(p) for p in ['\''Pillow'\'','\''setuptools'\'','\''wheel'\'']})"

  '
[[ "$before" = "$(fingerprint)" ]] || { echo 'Source changed; discard check result' >&2; exit 1; }
echo "Check evidence: $scratch"
