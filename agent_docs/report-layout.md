# Report layout

Background for work on the Split tab's layout — `app.scss`, and
`split-grid.ts`'s own styles for `.report` / `.grid`.

Most of this file is a record of approaches that were **tried and rejected**.
They look reasonable from a standing start, which is why they keep getting
re-attempted.

## The phone layout is a `min-height` flex chain

The Split tab's phone layout (`app.scss`'s `@media (max-width: 640px)`, plus
`split-grid.ts`'s own copy) fills the screen with a `min-height`-based flex
chain — `:host` (`app-root`) is `display: flex; flex-direction: column;
min-height: 100vh`, `main` is `flex: 1`. It is the same mechanism desktop uses,
just `min-height` instead of a rigid `height: 100vh`.

That is deliberate. `min-height` lets the column grow past one screen so the
page scrolls normally — needed for the on-screen keyboard and pull-to-refresh
to work — while still stretching `main` to fill the leftover space when content
is short.

**Rejected: `calc(100vh - <pixel constant>)`.** A static guess at the grid's
height was tried first. The header/toolbar/totals-band height it was guessing
at moves with content — a wrapped title, a warning line — so the guess drifts
and leaves a dead gap under the report once nothing (border, shadow, padding)
is there to visually absorb it.

Prefer extending the flex chain over reintroducing a `vh`-minus-a-constant
height anywhere in the report.

## Cancel a parent's padding at the source, not with a negative margin

`.report` runs edge-to-edge on a phone by zeroing `main`'s own padding for the
Split tab specifically — `main:has(app-split-grid) { padding: 0; }` in
`app.scss` — rather than giving `.report` a negative margin to cancel it.

**Rejected: a negative margin.** It silently failed on one edge only. Per the
CSS margin-collapsing spec, a child's `margin-top` collapses through a parent
with no top border/padding regardless of that parent's own height, but a
child's `margin-bottom` only collapses through a parent whose *own* height is
`auto` — and every element in this chain (`:host` down to `.report`) is sized
with an explicit `height: 100%`, not `auto`.

So the negative `margin-top` escaped and cancelled `main`'s top padding, while
the matching negative `margin-bottom` did nothing.
`getBoundingClientRect()` does not reveal why, since margin collapsing changes
layout rather than the element's own computed margin value.

## `display: none` moves a CSS Grid item's auto-placed neighbours

The totals band (`.totals-band` in `split-grid.ts`) is one CSS grid row:
the masthead cell, the grand-total cell, one cell per person, then the
add-person toggle cell, each auto-placed into successive tracks by
`grid-template-columns` (`totalsColumns`) in document order. None of them
carry their own `grid-column` — until `settings.totalsBandCollapsed` hides
the grand-total and person cells with `display: none`.

**Rejected: hiding cells with `display: none` and leaving the toggle cell's
position to auto-placement.** A `display: none` element is removed from the
grid entirely, not just painted empty — auto-placement compacts around the
gap, so every remaining item slides into the earliest free track. With the
grand/person cells gone, the toggle cell (last in the row, with nothing
after it to also slide) was pulled from the band's right edge into wherever
the first vacated track happened to be, landing beside the masthead cell
instead of above the grid's own add-person column it has to stay aligned
with.

Fixed by giving the toggle cell an explicit `grid-column: -3` (the
second-to-last line — the actual last track is the empty scrollbar spacer,
see `totalsColumns`), so its position holds regardless of what siblings are
hidden. The collapsed masthead cell's own `grid-column: 1 / -3` is the same
fix from the other side: rather than leave the vacated tracks as dead grid
space between the message and the toggle, it explicitly claims all of them.

`visibility: hidden` was not the answer either — tried mentally, not
committed: it keeps an item in grid flow (so no reposition), but it also
keeps the item's own intrinsic height contributing to the row's sizing,
defeating the whole point of a short collapsed row.

## Component style budgets

`web/angular.json`'s production config enforces a per-component CSS size budget
(`anyComponentStyle`: currently 12kB error / 7kB warning).

This is only checked by `ng build`. `tsc --noEmit` and `ng test` both pass
regardless of how large a component's styles get, so neither will catch a
budget breach. Run a full `npm run build` before pushing a change that adds CSS
to a component — particularly `split-grid.ts`, the fused report page, already
the largest component's styles by a wide margin.

If a legitimate addition pushes a component over the current error budget,
raise the number in `angular.json` rather than trying to golf the CSS to fit.
