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

## AG Grid integration gotchas

**Don't let two mechanisms write the same AG Grid option for the same
logical change.** An Angular `@Input` binding and an imperative
`api.setGridOption(...)` call both pushing the same `columnDefs` update in
close succession (one reactive, one explicit "just to be sure") left AG Grid
processing the change twice and rendering a duplicate, orphaned header —
found in `split-grid.ts`'s PNG-capture column restore. Pick one mechanism —
prefer the reactive binding — and drop the other rather than layering a
manual push "for safety" on top of a binding that already does the same job.

**A signal write reaching a bound `@Input` needs a real change-detection
pass, not just a `setTimeout` tick, in a Karma/TestBed spec — unlike the live
app.** In production, zone.js runs `ApplicationRef.tick()` automatically once
the zone stabilizes after a macrotask, so a bare `await new
Promise(resolve => setTimeout(resolve))` is enough for a signal change to
reach AG Grid. TestBed does not auto-run change detection the same way; a
spec has to call `fixture.detectChanges()` itself (this codebase's
`settle()` helper in `split-grid.spec.ts`) before reading anything that
depends on the update having landed. A test that only awaits a tick can pass
by coincidence rather than proving the update actually happened.
