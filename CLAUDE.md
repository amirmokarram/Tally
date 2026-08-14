# Project conventions

## Settings scope

Display preferences (e.g. totals band height, row-hover highlighting) live in
`ReportSettings` (`web/src/app/core/report-settings.ts`), under its own
`tally.settings` storage key — separate from `tally.library`
(`web/src/app/core/library-storage.ts`), which holds the saved splits/trips
themselves. These settings are global and apply the same way across every
split; they are not part of any trip's data and never travel with
export/import.

New display/UI preferences should default to this pattern (add a field to
`ReportSettings`, following the existing `totalsBandHeight`/`rowHoverEnabled`
shape) rather than being added to the `Trip`/`SavedSplit` model. Only put a
setting on the trip/split model itself if it's data that should travel with
that split (e.g. currency, who paid).

## Component style budgets

`web/angular.json`'s production config enforces a per-component CSS size
budget (`anyComponentStyle`: currently 11kB error / 7kB warning). This is
only checked by `ng build` — `tsc --noEmit` and `ng test` both pass regardless
of how large a component's styles get, so they will not catch a budget
breach. Run a full `npm run build` locally before pushing a change that adds
CSS to a component, particularly `split-grid.ts` (the fused report page,
already the largest component's styles by a wide margin). If a legitimate
addition pushes a component over the current error budget, raise the number
in `angular.json` rather than trying to golf the CSS to fit.
