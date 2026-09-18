# Upgrade fixtures

- `project-data/` contains downstream-owned cards, epics, context, and artifacts.
- `customized/server-append.txt` turns the stock legacy server into a managed-file conflict.
- `migration/data/state.json` is the pre-migration project payload used by migration tests.
- The stock pre-upgrader tree is materialized by `fixtures.mjs` from the bundled
  `7749c12` baseline and the matching Git objects, so every managed byte is checked
  against the release baseline instead of maintaining a second hand-edited copy.

All fixtures are copied into temporary directories. They never write to the active
board or this repository's project-owned data.
