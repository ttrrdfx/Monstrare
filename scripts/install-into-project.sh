#!/usr/bin/env bash
set -euo pipefail

target="${1:-}"

if [[ -z "$target" ]]; then
  echo "usage: scripts/install-into-project.sh /path/to/project"
  exit 1
fi

if [[ ! -d "$target" ]]; then
  echo "target is not a directory: $target"
  exit 1
fi

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec node "$root/scripts/monstrare.mjs" install "$target"
