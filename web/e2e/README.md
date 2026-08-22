# E2E scope

Playwright, headless Chromium, run against a real `ng serve`. See
`CLAUDE.md`'s Testing section for how this fits next to the Karma suite.

Covered: creating a split and seeing a balance, the JSON export/import
round trip, ticking + a bulk action on the ledger grid, and drag-select +
real browser clipboard copy/paste — the app's own reimplementation of AG
Grid Enterprise's row grouping and range selection, respectively (see
`agent_docs/ag-grid.md`).

Deliberately not covered yet — add a spec here if one of these becomes the
next priority, don't build all of it speculatively:

- PNG export (needs pixel comparison, a different kind of test)
- Settle-up detail (splits-panel's expandable transfer list)
- Multi-tab sync (needs two browser contexts; the highest flake risk of
  anything on this list)
- The currency picker
- The fill handle (dragging a selection's own corner to repeat it, as
  distinct from the plain drag-select `drag-select-clipboard.spec.ts`
  covers) and row drag-reorder (`rowDragMultiRow`)
