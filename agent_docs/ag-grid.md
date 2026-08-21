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
