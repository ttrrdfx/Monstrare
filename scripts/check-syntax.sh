#!/usr/bin/env bash
set -euo pipefail

roots=(scripts tools/kanban)
if [[ -d test/monstrare ]]; then
  roots+=(test/monstrare)
fi

while IFS= read -r -d '' file; do
  node --check "$file"
done < <(find "${roots[@]}" -type f -name '*.mjs' -print0 | sort -z)

while IFS= read -r -d '' file; do
  bash -n "$file"
done < <(find scripts -type f -name '*.sh' -print0 | sort -z)

echo "syntax check passed"
