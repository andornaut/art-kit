#!/usr/bin/env bash
# Pillow 13.0.0 references for the GIF and ICO encoders.
# generate: rewrites pillow.json from Pillow's decodes of its own saves.
# crosscheck: encodes the fixture inputs with the current Node source and compares Pillow's decodes.
# <provision-directory> is the output of scripts/provision.sh.
set -euo pipefail
[[ $# = 2 && ($1 = generate || $1 = crosscheck) ]] || { echo 'Usage: pillow.sh <generate|crosscheck> <provision-directory>' >&2; exit 2; }
exec node "$(dirname -- "${BASH_SOURCE[0]}")/../../../../scripts/container.mts" pillow "$@"
