# AG Grid integration

Background for work on the ledger grid. Read this when touching
`components/split-grid.ts`, `components/ledger-model.ts`,
`components/cell-range.ts` or `components/sheet-cell.ts`.

## Community only, and what that costs

The app uses AG Grid **Community** — MIT, no licence key, no seat cost.
Nothing may import `ag-grid-enterprise`. Two features the enterprise build
would have given us are therefore the app's own code:

- **Row grouping** → the sheet blocks are cell spanning (`enableCellSpan` +
  `spanRows`) over the flat row array built in `components/ledger-model.ts`.
- **Range selection and clipboard** → the rectangle in
  `components/cell-range.ts`, driven from `components/split-grid.ts`, writing
  through the columns' own `valueSetter`s so a paste obeys exactly the rules
  typing does.

That last detail is the point of the design: there is one path into the model,
so paste can never produce a value typing would have rejected.

## Don't let two mechanisms write the same grid option

An Angular `@Input` binding and an imperative `api.setGridOption(...)` call
both pushing the same `columnDefs` update in close succession (one reactive,
one explicit "just to be sure") left AG Grid processing the change twice and
rendering a duplicate, orphaned header — found in `split-grid.ts`'s
PNG-capture column restore.

Pick one mechanism — prefer the reactive binding — and drop the other, rather
than layering a manual push "for safety" on top of a binding that already does
the same job.

## A signal write needs a real change-detection pass in a spec

In production, zone.js runs `ApplicationRef.tick()` automatically once the zone
stabilizes after a macrotask, so a bare
`await new Promise(resolve => setTimeout(resolve))` is enough for a signal
change to reach AG Grid through a bound `@Input`.

TestBed does not auto-run change detection the same way. A spec has to call
`fixture.detectChanges()` itself — that is what `settle()` in
`split-grid.spec.ts` exists for:

```ts
async function settle(fixture: ComponentFixture<SplitGrid>): Promise<void> {
  fixture.detectChanges();
  await new Promise((resolve) => setTimeout(resolve));
  fixture.detectChanges();
}
```

A test that only awaits a tick can pass by coincidence rather than proving the
update actually happened.

## `MIN_BLOCK_ROWS` and the Sheet cell's `min-height` are one invariant

They are not two independent numbers. AG Grid spans the Sheet cell across
exactly `MIN_BLOCK_ROWS` rows once, when the block is built, and never revisits
that span as the cell's own height changes.

If the cell's `min-height` floor (`sheet-cell.ts`) is taller than

```
(MIN_BLOCK_ROWS - 1) * LEDGER_ROW_HEIGHT + LEDGER_ADD_ROW_HEIGHT - 1
```

— the row-based height `sheet-cell.ts`'s own `effect()` computes — the cell
renders taller than the row-space actually reserved for it and spills past its
own block. Raising one means raising the other to match.

`ledger-model.spec.ts` hardcodes the resulting filler-row counts, so changing
either number breaks specs that a DOM-only browser check will not catch. Run
the full test suite, not just a build, after touching either constant.

A PNG capture drops every add-item row outright (`printRows`, `split-grid.ts`)
rather than collapsing it to `LEDGER_ADD_ROW_HEIGHT` the way the screen does —
there is nothing to type on in a still image. That row was one of the rows
paying for the floor above, so the same `MIN_BLOCK_ROWS` that clears it on
screen can fall short during a capture specifically. `MIN_BLOCK_ROWS_CAPTURING`
(`ledger-model.ts`) is the same invariant solved a row taller, used only while
`isCapturing()`; `printRows` builds its own row array off it rather than
filtering the screen's, and `sheet-cell.ts`'s height `effect()` passes it to
`ledgerBlockSize` in step. Lower `LEDGER_ROW_HEIGHT` again and both constants
need re-checking against the floor, not just the screen-facing one.

## `selectedRowBackgroundColor` is dead for a spanned row

The Theming API's own row-selection overlay only paints when the row element
carries the base `.ag-row` class alongside `.ag-row-selected` — that pairing
is what sets `--ag-internal-row-overlay-color` to
`var(--ag-selected-row-background-color)` in AG Grid's generated CSS. A row
that spans (`ag-spanned-row`, this app's own cell-span reimplementation — see
above) never carries plain `.ag-row`, so the variable never gets set and the
whole-row wash never renders, regardless of what `selectedRowBackgroundColor`
is set to in `grid-theme.ts`.

The only visible selection cue on this grid is therefore whatever CSS a
column's own `cellClassRules` paints by hand off `node.isSelected()` —
`.ledger-index-ticked` on the index column. Setting
`selectedRowBackgroundColor` still matters (some AG Grid chrome outside the
spanned rows reads it), but do not expect it to colour a ledger row on its
own; confirm any row-selection colour change by inspecting the actual
ticked-cell element, not the theme param.

## Read the grid's live state, don't re-derive it

AG Grid's outputs are asynchronous, and `colSpan` and row-height-driven
centering both depend on state the grid owns. Ask the `GridApi` what is
currently true rather than recomputing it from the model and assuming the two
agree.

## Overriding one of AG Grid's own icons

The `icons` grid option takes a raw HTML string (or a function returning one)
per icon name, and AG Grid uses it in place of the theme's built-in glyph
whenever one is supplied — regardless of Community vs Enterprise, and
regardless of the Theming API (`themeQuartz.withParams(...)`, what this app
uses) vs the older CSS-class themes. `split-grid.ts` binds `[icons]="icons"`
with `{ rowDrag: ROW_DRAG_ICON }` to replace AG Grid's own six-dot row-drag
grip with the four-dot one drawn in `person-reorder-dialog.html` and
`sheet-reorder-dialog.html`, so every "drag this to reorder" handle in the app
reads as the same control.

The override is inserted as a plain HTML string, not a template — it bypasses
the theme's own CSS classes entirely, so the SVG needs its own
`fill="currentColor"` to pick up the surrounding element's icon color rather
than rendering invisibly or in the wrong shade.

## A custom header component isn't AG Grid's own selection column

`select-cell.ts` (removed — see `f3c219c` in history) drew tick boxes into AG
Grid's *own* checkbox-selection column, reachable only through
`checkboxSelection`/`headerCheckboxSelection` on a `colDef`. That column is
one `ColumnModel.refreshCols` prepends to the front of the column list on
every rebuild (`lockPosition` aside), so it could never be placed after Sheet
and the line number — which is why ticking moved off a dedicated column
entirely and onto the line-number column's own cells, and why the header lost
its tick box too.

`index-header.ts`'s header isn't that column, though: it's a plain
`headerComponent` on the ordinary `index` colDef this app already controls
the position of, same as `person-header.ts` or any other custom header here.
Reading and writing `node.isSelected()` through the `GridApi` is still
AG Grid's own `RowSelectionModule`, but *drawing* that state — a `#` glyph, a
real three-state `<input type="checkbox">`, whatever reads best — is free to
change without hitting the positioning constraint above. Only a `colDef`
actually opting into `checkboxSelection` would.

## `rowDragMultiRow` drags the whole ticked selection, and is Community too

Dragging a ticked line by its handle drags every other ticked line along with
it — `[rowDragMultiRow]="true"` in `split-grid.html`, same `RowDragModule` as
plain single-line drag, no Enterprise fallback needed. AG Grid decides this
itself: if the row a drag starts on is part of the current selection
(`node.isSelected()`, the hand-rolled ticking above), `getSelectedNodes()`
supplies the whole set; otherwise only the grabbed row drags, ignoring
whatever else happens to be ticked.

`onRowDragEnd` (`split-grid.ts`) does not special-case the multi-row count.
`rowDragManaged` has already reordered AG Grid's own row model — one line or
several — by the time the handler fires, so it always reads the dragged
sheet's *entire* resulting order back via `forEachNode` and writes it whole
through `TripStore.reorderItems(sheetId, orderedItemIds)`, rather than
computing a per-line delta. `reorderItems` replaces the sheet's `items` array
to match that order outright; it is the general case `moveItem`'s
single-entry splice was a special case of.

`isRowValidDropPosition` checks every entry in `params.rows` (the whole
dragged set) against the drop target's `sheetId`, not just `params.source`
(the one line whose handle was grabbed) — a ticked selection spanning more
than one sheet would otherwise let AG Grid's flat row array physically
interleave another sheet's line into this one's block, which nothing in the
per-sheet `items` model or the cell-span reimplementation above expects. A
multi-sheet selection dragged this way is simply rejected; there is no
partial-drop behavior.

**A `kind !== 'item'` row a drag merely passes over can read as the whole
drop being refused, not just that one hover.** An earlier version of
`isRowValidDropPosition` rejected the "add" row and any filler row outright,
on the theory that only another line is ever a sensible drop target. In
practice AG Grid tracks validity live as the pointer moves — every hover, not
just the release point — and a drag from high up a sheet down to its last
line has to cross that "add"/filler stretch below the last line to get
there, or overshoot it and come back. Rejecting that stretch showed the
"not-allowed" cursor for however much of the drag passed over it, which reads
as the whole gesture having failed even on a path that ends over a perfectly
valid line. The fix: the "add" row and filler rows of the dragged lines' own
sheet are valid drop targets too — the natural way to make a line the
sheet's new last line, symmetric with dropping "below" the line that used to
be last.

**Allowing that hover is not enough on its own — it also has to force where
the row lands, or the fix produces a worse bug than the one it replaces.**
Returning a bare `true` for an "add"/filler target leaves AG Grid free to
pick `position: 'below'` depending on which half of the row the pointer sits
over, same as any other row. "Below" the filler row lands one slot too low —
between "add" and filler — and "below" the "add" row lands between "add" and
the first item wrapped from the top, if there's more than one item; either
way `rowDragManaged`'s live-preview reorder physically splices the dragged
line in *after* "add", inside AG Grid's own row model, which
`ledger-model.ts`'s fixed items-then-"add"-then-filler layout never expects
and never re-sorts back — that layout is only ever produced fresh from the
store's `items` array, never renegotiated in place. Worse, `onRowDragEnd`
reads the sheet's new order back by collecting `kind === 'item'` rows in
visitation order, so a line spliced in after "add" without changing position
*relative to other items* looks identical to a no-op drag — `onRowDragEnd`
skips writing back (the same skip that keeps a genuine drop-in-place off the
undo stack), so nothing ever tells the grid to rebuild that sheet's block
from the store again, and the broken layout sits there indefinitely — through
undo/redo, though *not* a page reload, since that rebuilds the row list fresh
from the store's own (never actually corrupted) `items` array rather than
carrying AG Grid's in-memory row model forward — until literally any other
edit touches that sheet. The fix returns an explicit `{ position: 'above', target:
<the sheet's "add" row node> }` for both the "add" row and any filler row —
not `overNode` itself — so a drop anywhere in that stretch always lands
immediately above "add", the one position that keeps every item ahead of it
regardless of which of the two rows, or which half of it, was under the
pointer.

**`isRowValidDropPosition` needs to read `params.target`, not
`params.overNode` — they silently diverge, and the divergence looks
intermittent from the outside.** `overNode` is just whatever row is under the
pointer's raw Y pixel. `target` is what AG Grid actually splices the dragged
rows against, and AG Grid substitutes a *different* node into it
(`deltaDraggingTarget`, in AG Grid's own source) whenever `overNode` happens
to be one of the rows currently being dragged: it walks forward, in the
direction of travel, to the next row that *isn't* part of the drag, and uses
that instead. Hovering a ticked line that already sits right next to "add" —
which happens naturally once a multi-line drag has partly landed — is exactly
when this fires, and the substituted `target` becomes the "add" row itself
while `overNode` still reports an ordinary `item` row. A version of this fix
keyed on `overNode` sailed through every hand-built and real-pointer-driven
test in the suite, because none of them happened to end a drag hovering one
of the dragged lines' own rows — the gap only showed up as an intermittent
"drops under New Row" report from actual use, since whether it fires depends
on the ticked group's position at that instant relative to "add", not on
anything visibly under the pointer. `params.target` already carries AG Grid's
own substitution by the time the validator runs — reading it instead closes
the gap without needing to reimplement `deltaDraggingTarget`'s own logic.
