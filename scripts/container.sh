# shellcheck shell=bash
# Container policy shared by the check, packaging and provisioning scripts. Source it; do not execute it.
# Containers run as uid 19001, which owns nothing on the host. Every host path is a read-only bind mount,
# readable through the path's group or world bits. Writable state lives in a per-run named volume at /tmp
# (copied up from the image's 1777 /tmp), and results leave through docker cp as the host user.

require_idle() {
  local one_minute
  one_minute=$(cut -d ' ' -f 1 /proc/loadavg)
  awk -v one_minute="$one_minute" 'BEGIN { exit !(one_minute < 24) }' || { echo 'One-minute load must be below 24' >&2; exit 1; }
}

fingerprint() {
  local root=$1
  { git -C "$root" status --porcelain=v1 -z; git -C "$root" ls-files --cached --others --exclude-standard -z | sort -z | while IFS= read -r -d '' path; do sha256sum "$root/$path"; done; } | sha256sum
}

# guard_source <root>: discard the result if Git status or listed file contents change before exit.
guard_source() {
  source_root=$1
  source_before=$(fingerprint "$source_root")
}

verify_source() {
  [[ -z "${source_root:-}" || "$source_before" = "$(fingerprint "$source_root")" ]] || { echo 'Source changed; discard result' >&2; exit 1; }
}

# container_init <name-prefix> <network>: set $container and the policy flags in $container_args.
container_init() {
  container="$1-$$-$RANDOM"
  container_args=(--name "$container" --network "$2" --read-only --cpus 4
    --user 19001:19001 -e HOME=/tmp --cap-drop ALL --security-opt no-new-privileges
    --mount "type=volume,source=$container,target=/tmp")
}

# readonly_mount <source> <target>: bind a host path read-only and grant its group for reading.
readonly_mount() {
  container_args+=(--mount "type=bind,source=$1,target=$2,readonly" --group-add "$(stat -c %g "$1")")
}

container_cleanup() {
  [[ -n "${container:-}" ]] || return 0
  docker rm -f "$container" >/dev/null 2>&1 || true
  docker volume rm "$container" >/dev/null 2>&1 || true
  container=
}

container_finish() {
  local result=$?
  trap - EXIT
  container_cleanup
  verify_source
  exit "$result"
}
trap container_finish EXIT
