# E2E scope

Playwright, headless Chromium, run against a real `ng serve`. See
`CLAUDE.md`'s Testing section for how this fits next to the Karma suite.

Covered: creating a split and seeing a balance, the JSON export/import
round trip, and ticking + a bulk action on the ledger grid (the app's own
reimplementation of AG Grid Enterprise's row grouping — see
`agent_docs/ag-grid.md`).

Deliberately not covered yet — add a spec here if one of these becomes the
next priority, don't build all of it speculatively:

- PNG export (needs pixel comparison, a different kind of test)
- Settle-up detail (splits-panel's expandable transfer list)
- Multi-tab sync (needs two browser contexts; the highest flake risk of
  anything on this list)
- The currency picker
- Drag-select / clipboard on the grid (cell-range.ts) — the natural next
  spec once more row/cell locator patterns exist to build on
