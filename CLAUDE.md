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

## Toolbar dropdown menus

The Split tab's toolbar (`split-grid.html`/`.ts`) is measured, breakpoint-
tuned space (see the container-query comments above `.toolbar-cluster`) —
a permanent button per action is not free. When two or more toolbar actions
are close variants of the same thing (Export's Save as JSON/Save as PNG,
Reorder's Sheets/People, Add's Sheet/Person), give them one button with a
caret that opens a small `.toolbar-menu` dropdown (`toggleExportMenu` /
`toggleReorderMenu` / `toggleAddMenu` on the host are the pattern to copy)
rather than a permanent button each. Mirror the same button, with a
`menu-submenu-caret` instead, in the "More actions" overflow menu for
narrow screens. Iconed options (Export) read as different destination
formats; plain-text options (Add, Reorder) read as the same kind of thing
applied to a different entity — match whichever your two options are.

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

**The Sheet cell's CSS `min-height` (`sheet-cell.ts`) and `MIN_BLOCK_ROWS`
(`ledger-model.ts`) are a paired invariant, not two independent numbers.**
AG Grid spans the Sheet cell across exactly `MIN_BLOCK_ROWS` rows once, when
the block is built, and never revisits that span as the cell's own height
changes. If the cell's `min-height` floor is taller than
`(MIN_BLOCK_ROWS - 1) * LEDGER_ROW_HEIGHT + LEDGER_ADD_ROW_HEIGHT - 1` (the
row-based height `sheet-cell.ts`'s own `effect()` computes), the cell renders
taller than the row-space actually reserved for it and spills past its own
block. Raising one means raising the other to match. `ledger-model.spec.ts`
hardcodes the resulting filler-row counts, so changing either number breaks
specs that a DOM-only browser check won't catch — run the full `ng test`
suite, not just `ng build`, after touching either constant.

## Mobile report layout

The Split tab's phone layout (`app.scss`'s `@media (max-width: 640px)`,
`split-grid.ts`'s own copy for `.report`/`.grid`) fills the screen with a
`min-height`-based flex chain — `:host` (`app-root`) is `display: flex;
flex-direction: column; min-height: 100vh`, `main` is `flex: 1` — the same
mechanism desktop uses, just `min-height` instead of a rigid `height: 100vh`.
That's deliberate: `min-height` lets the column grow past one screen so the
page scrolls normally (needed for the on-screen keyboard and pull-to-refresh
to work), while still stretching `main` to fill the leftover space when
content is short. A static `calc(100vh - <pixel constant>)` guess at the
grid's height was tried first and rejected — the header/toolbar/totals-band
height it was guessing at moves with content (a wrapped title, a warning
line), so the guess drifts and leaves a dead gap under the report once
nothing (border, shadow, padding) is there to visually absorb it. Prefer
extending this flex chain over reintroducing a `vh`-minus-a-constant height
anywhere in the report.

**Cancel a parent's padding at the source, not with a negative margin, when
the parent is part of a fixed-`height` chain.** `.report` runs edge-to-edge
on a phone by zeroing `main`'s own padding for the Split tab specifically
(`main:has(app-split-grid) { padding: 0; }` in `app.scss`), rather than
giving `.report` a negative margin to cancel it. A negative margin was tried
first and silently failed on one edge only: per the CSS margin-collapsing
spec, a child's `margin-top` collapses through a parent with no top
border/padding regardless of that parent's own height, but a child's
`margin-bottom` only collapses through a parent whose *own* height is `auto`
— and every element in this chain (`:host` down to `.report`) is sized with
an explicit `height: 100%`, not `auto`. The negative `margin-top` escaped
and cancelled `main`'s top padding; the matching negative `margin-bottom`
did nothing, and `getBoundingClientRect()` doesn't reveal why since margin
collapsing changes layout, not the element's own computed margin value.
