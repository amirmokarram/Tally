/**
 * The ledger — the whole trip in one grid.
 *
 * People, expense sheets and the owe/pay grid used to be three tabs. They were
 * always one thing: the Split sheet already *showed* all of it, and you had to
 * leave it to change any of it. Here the same grid is where it is typed:
 *
 *   - people are the columns, named and reordered from their headers;
 *   - each expense sheet spans a block of rows, its settings behind a popup
 *     editor on the spanned cell;
 *   - the last row of a block adds an item;
 *   - lines are ticked down the left and acted on together from the toolbar,
 *     which is where the buttons that used to ride every row now live.
 *
 * A cell in a person column holds the workbook's packed `owe.pay` number: the
 * whole part is how much of the item that person is on the hook for *relative
 * to the others in the same row*, and the first decimal is how much of it they
 * already paid. `1.2` therefore reads "owes one share, paid two".
 *
 * Selecting a block of cells and copying or pasting it is this file's own work
 * for the same reason the sheet blocks are: AG Grid's range selection and
 * clipboard are both Enterprise. See {@link SplitGrid.onCellMouseDown} down to
 * {@link SplitGrid.onPaste}, over the rectangle in `cell-range.ts`.
 *
 * AG Grid Community only — see `docs/PORTING-NOTES.md`. Nothing here may import
 * `ag-grid-enterprise`.
 */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  isDevMode,
  signal,
} from '@angular/core';
import { AgGridAngular } from 'ag-grid-angular';
import {
  CellSpanModule,
  CellStyleModule,
  ClientSideRowModelModule,
  CellApiModule,
  CellMouseDownEvent,
  CellMouseOverEvent,
  ColDef,
  ColumnApiModule,
  ColumnMovedEvent,
  _ColumnMoveModule,
  GetRowIdParams,
  GridApi,
  GridReadyEvent,
  IRowNode,
  ModuleRegistry,
  NumberEditorModule,
  PinnedRowModule,
  RenderApiModule,
  RowApiModule,
  RowClassParams,
  RowHeightParams,
  RowSelectionModule,
  RowSelectionOptions,
  ScrollApiModule,
  RowStyleModule,
  SelectionChangedEvent,
  TextEditorModule,
  ValidationModule,
  ValueGetterParams,
  ValueSetterParams,
} from 'ag-grid-community';

import { TripStore } from '../core/trip-store';
import { MoneyPipe } from '../core/money.pipe';
import { packShare, unpackShare } from '../models/trip.model';
import { LedgerItemRow, LedgerRowData, buildLedgerRows, ledgerRowId } from './ledger-model';
import {
  CellRange,
  CellRef,
  extendRange,
  fromClipboardText,
  isSingleCell,
  RangeBounds,
  rangeBounds,
  rangeHas,
  toClipboardText,
} from './cell-range';
import { LEDGER_ROW_HEIGHT, ledgerTheme } from './grid-theme';
import { AddSheetHeader, SheetCell } from './sheet-cell';
import { SheetEditor } from './sheet-editor';
import { AddPersonHeader, PersonHeader } from './person-header';
import { IndexHeader } from './index-header';

// Community modules only, and named one by one rather than pulled in as
// `AllCommunityModule`: the bundle is shipped to a GitHub Pages demo, and the
// filtering, sorting, pagination, export and selection this grid does not use
// are most of AG Grid's weight.
//
// Registered once, at import, so the tests that create the component get the
// same grid the app does.
ModuleRegistry.registerModules([
  ClientSideRowModelModule,
  CellSpanModule, // the sheet blocks — AG Grid's own grouping is Enterprise
  CellStyleModule, // cellClass / cellClassRules
  RowStyleModule, // getRowClass
  PinnedRowModule, // the balance strip
  RowSelectionModule, // the tick boxes, and the column they live in
  TextEditorModule, // the Item column
  NumberEditorModule, // Amount and the share cells
  // `api.getColumns()`, `api.getRowNode()`, `api.getCellValue()`. Nothing in
  // the app calls them — they are how the tests drive the real grid instead of
  // asserting against a mock of it, which is worth their small weight.
  ColumnApiModule,
  RowApiModule,
  CellApiModule,
  // `api.ensureColumnVisible` — a person added from the toolbar is a column off
  // the right-hand edge until the grid is scrolled to it.
  ScrollApiModule,
  // `api.refreshCells` — repaints the selected block as a drag moves over it.
  RenderApiModule,
  // Dragging a person's own header to reorder it. The leading underscore is
  // AG Grid's own naming for a module carved out of what used to be part of
  // the free bundle — it ships from `ag-grid-community`, not `-enterprise`.
  _ColumnMoveModule,
  // Turns AG Grid's numbered warnings into readable ones. Dropped from the
  // production bundle, which is a large part of the saving.
  ...(isDevMode() ? [ValidationModule] : []),
]);

/** Marks the Sheet column's value on the row that adds a sheet. */
const NO_SHEET = '(no sheet)';

/**
 * The app's money formatting — thousands separators, and a credit in
 * parentheses rather than behind a minus sign, which is how the spreadsheet
 * showed someone who is owed. Reused through the pipe class so the grid cannot
 * drift from the rest of the app.
 */
const money = new MoneyPipe();

@Component({
  selector: 'app-split-grid',
  imports: [AgGridAngular, SheetEditor],
  templateUrl: './split-grid.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    // The clipboard events are taken on the host rather than on the document:
    // they reach here by bubbling from the focused cell, so a copy aimed at
    // something else on the page is left alone.
    '(copy)': 'onCopy($event)',
    '(paste)': 'onPaste($event)',
    // A drag can end anywhere, including outside the grid.
    '(document:mouseup)': 'endDrag()',
    '[class.dragging]': 'dragging || fillDragging',
    '[class.filling]': 'fillDragging',
  },
  styles: `
    :host {
      display: block;
    }

    /* A drag across cells would otherwise sweep up the text under it. */
    :host(.dragging) ::ng-deep .ag-center-cols-viewport {
      user-select: none;
    }

    /* A crosshair over the whole grid while the fill handle is out, not just
       over the handle itself — the pointer is over other cells for most of
       the drag, and a lingering text-input cursor there would read as if
       nothing were happening. */
    :host(.filling) ::ng-deep .ag-center-cols-viewport {
      cursor: crosshair;
    }

    .legend {
      display: flex;
      flex-wrap: wrap;
      gap: 6px 18px;
      margin: 0 0 16px;
      color: var(--text-muted);
      font-size: 13px;
    }

    .legend code {
      background: var(--navy-050);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 1px 5px;
      color: var(--text);
      font-size: 12px;
    }

    /* Tall enough to be a working surface, short enough that the topbar, the
       alert strip and the footer all stay on screen. */
    .grid {
      display: block;
      width: 100%;
      height: clamp(320px, calc(100vh - 260px), 900px);
    }

    /* The editor panel floats over the grid rather than inside a cell: the
       grid's viewport clips its own cells, and the rows carry a transform, so
       neither absolute nor fixed positioning escapes from in there. */
    .editor-backdrop {
      position: fixed;
      inset: 0;
      z-index: 60;
      background: rgb(20 53 95 / 22%);
    }

    .editor-panel {
      position: fixed;
      z-index: 61;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
    }

    /* Above the grid, not below: these two used to cost a whole column and a
       row of grid space between them, and the grid is the thing that wants
       every pixel. */
    .toolbar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px 12px;
      margin-bottom: 12px;
    }

    .toolbar-hint {
      font-size: 12px;
      color: var(--text-muted);
    }

    .toolbar-count {
      font-size: 12px;
      font-weight: 600;
      color: var(--navy-800);
    }

    /* The panel floats over the grid rather than inside a cell: the grid clips
       its own viewport, and the rows carry a transform, so neither absolute nor
       fixed positioning escapes from in there. */
    .editor-backdrop {
      position: fixed;
      inset: 0;
      z-index: 60;
      background: rgb(20 53 95 / 22%);
    }

    .editor-panel {
      position: fixed;
      z-index: 61;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
    }

    :host ::ng-deep .ledger-total {
      font-weight: 650;
      font-size: 15px;
    }

    /* The add rows are scaffolding, not data — they should recede until used. */
    :host ::ng-deep .ledger-add-row {
      --ag-cell-horizontal-border: none;
    }


    /* Padding under the add row, there only to give a short block the height
       its heading is written down. Nothing sits on it and nothing can be typed
       on it, so it should read as part of the block rather than as a line: no
       rules of its own, and none of the striping the rows carry — a fine
       diagonal hatch instead, the spreadsheet convention for "not a cell you
       can type in," faint enough to read as texture rather than compete with
       the rows around it.
       The same hatch covers the add-person column's own cell on every row,
       not just this one: the button that adds a person lives in its header,
       not down here, so every cell below it — an item row's, the totals
       row's, an add row's — is exactly as untypeable as a filler row's are.
       The hatch has to sit on each \`.ag-cell\`, not the row: a cell paints its
       own opaque background over whatever the row underneath it has. */
    :host ::ng-deep .ledger-filler-row {
      --ag-cell-horizontal-border: none;
    }

    :host ::ng-deep .ledger-filler-row .ag-cell,
    :host ::ng-deep .ledger-add-person-cell {
      background-color: var(--surface);
      background-image: repeating-linear-gradient(
        45deg,
        transparent,
        transparent 4px,
        color-mix(in srgb, var(--text-muted) 14%, transparent) 4px,
        color-mix(in srgb, var(--text-muted) 14%, transparent) 5px
      );
    }

    /* All of them but the sheet's own heading: a sheet with no lines yet is a
       block of one row, so its name, charges and panel button sit *on* the add
       row — and they are the sheet, not scaffolding for it. */
    :host ::ng-deep .ledger-add-row .ag-cell:not(.ledger-sheet-cell) {
      color: var(--text-muted);
      font-style: italic;
    }

    :host ::ng-deep .ledger-paid {
      background: var(--paid-bg);
    }

    /* A priced row nobody has claimed a share of — the workbook's red cells. */
    :host ::ng-deep .ledger-missing {
      background: var(--credit-bg);
    }

    /* Scaffolding for the eye, not data: it should sit behind everything. */
    :host ::ng-deep .ledger-index {
      justify-content: flex-end;
      color: var(--text-muted);
      font-variant-numeric: tabular-nums;
      font-size: 12px;
    }

    /* A line's own number doubles as its tick box now, so it needs to read as
       pressable — the checkbox it replaces had a pointer cursor by default. */
    :host ::ng-deep .ledger-index-tickable {
      cursor: pointer;
    }

    /* The ticked state, in the same ink used for the cell-range selection so
       the two read as the same kind of thing: chosen. */
    :host ::ng-deep .ledger-index-ticked {
      background: var(--navy-050);
      color: var(--navy-700);
      font-weight: 600;
    }

    :host ::ng-deep .ledger-numeric {
      font-variant-numeric: tabular-nums;
      justify-content: flex-end;
    }

    :host ::ng-deep .ledger-share {
      font-variant-numeric: tabular-nums;
      font-weight: 600;
      justify-content: center;
    }

    /* The balances row's own share cells — each person's running total —
       turned the same quarter turn as their header just above (see
       \`person-header.ts\`), so the figure reads in the same direction as the
       name it belongs to. \`getRowHeight\` gives this one row 20 extra pixels
       so a longer balance has the same room to run that the turn needs.
       An \`.ag-cell\` is a plain block box by default — \`display: flex\` here is
       what makes \`align-items\`/\`justify-content\` mean anything, the same way
       \`person-header.ts\`'s own \`:host\` declares it. \`justify-content:
       flex-start\` pins the figure to the cell's bottom edge — the edge
       \`sideways-lr\`'s own bottom-up reading direction starts from — rather
       than centring it top-to-bottom. \`align-items: center\` is the other
       axis, centring it across the column's width. */
    :host ::ng-deep .ledger-balances-row .ledger-share {
      display: flex;
      writing-mode: sideways-lr;
      justify-content: flex-start;
      align-items: center;
      overflow: hidden;
      padding: 4px;
    }

    :host ::ng-deep .ledger-credit {
      color: var(--credit);
    }

    /* The selected block. An inset ring rather than a fill, so the paid and
       unassigned colours underneath still read through it. */
    :host ::ng-deep .ledger-selected {
      background: var(--navy-050);
      box-shadow: inset 0 0 0 1px var(--navy-700);
    }

    /* The little square a spreadsheet leaves at a selection's own
       bottom-right corner — this app's stand-in for the fill handle AG Grid
       keeps behind Enterprise's range selection. It sits on the cell's own
       border rather than inside it, the way the real thing does, which is why
       the cell needs \`position: relative\` under it. */
    :host ::ng-deep .ledger-fill-handle {
      position: relative;
    }

    :host ::ng-deep .ledger-fill-handle::after {
      content: '';
      position: absolute;
      right: -1px;
      bottom: -1px;
      width: 7px;
      height: 7px;
      background: var(--navy-700);
      border: 1px solid var(--surface);
      cursor: crosshair;
    }

    /* The block a fill drag is about to cover, while the handle is still
       out — dashed rather than the selection's own solid ring, so mid-drag it
       reads as a preview of what letting go would do, not as chosen yet. */
    :host ::ng-deep .ledger-fill-preview {
      outline: 1px dashed var(--navy-700);
      outline-offset: -1px;
    }

    /* \`ag-right-aligned-header\`, set by the \`numericColumn\` type, right-aligns
       the title through \`.ag-header-cell-text\`'s own \`text-align: end\` — the
       one part of the type this column keeps only for its cell values, not
       its title. */
    :host ::ng-deep .ledger-amount-header .ag-header-cell-text {
      text-align: start;
    }

    /* The Sheet cell is a spine of sideways boxes rather than a line of text:
       it takes the whole cell, and the cell's own side padding — which would be
       half of a column this narrow — has to go. */
    :host ::ng-deep .ledger-sheet-cell {
      align-items: stretch;
      padding: 0;
      line-height: 1.35;
    }

    /* The header over that column holds one 26-pixel button, and AG Grid's
       16 either side would leave it 6 off the centre of a column the cells
       below fill edge to edge. */
    :host ::ng-deep .ledger-sheet-header {
      /* Through the variable AG Grid's own rule reads, not over the top of it:
         the theme's stylesheet is injected at runtime, after this one, so a
         \`padding\` of ours at the same specificity loses. */
      --ag-cell-horizontal-padding: 0px;
    }

    /* The same fix, for the same reason: a person column turned on its side
       is 44 pixels wide, and AG Grid's 16 either side would leave the header
       component 12 to work with instead of the 44 it is sized for. */
    :host ::ng-deep .ledger-person-header {
      --ag-cell-horizontal-padding: 0px;
    }

    /* AG Grid raises a row to \`z-index: 1\` for as long as one of its cells is
       being edited — headroom meant for an editor's own dropdown to sit above
       the *other* rows around it. The layer that paints every spanned cell,
       \`.ag-spanning-container\`, sits at that same \`z-index: 1\`, one level away
       from the ordinary rows it is meant to always paint over. A tie is broken
       by DOM order, not by which one is "supposed" to win, and the row being
       edited is later in it — so for as long as editing lasts, that row's own
       (Sheet-less) background paints over the merged Sheet cell for the width
       of its own band, cutting a stripe out of whichever name or charge box the
       edited row's height happens to fall across.
       Raised a level above what AG Grid gives an editing row, so the spanned
       layer — and the whole Sheet column drawn inside it — wins the tie
       outright rather than by DOM-order luck.
       The layer itself is transparent and stretches the full width of every
       row, not just the Sheet column's — only its own spanned-cell children
       (the merged Sheet cell, here) draw anything. Raising it a level without
       also punching a hole in its hit-testing would let that transparent
       stretch swallow clicks meant for the Item, Amount and person cells
       beneath it, so the layer itself is taken out of pointer handling and
       given back only where a spanned cell actually is. */
    :host ::ng-deep .ag-spanning-container {
      z-index: 2;
      pointer-events: none;
    }

    :host ::ng-deep .ag-spanned-cell-wrapper {
      pointer-events: auto;
    }

    /* A block tall enough to scroll past where the header sits paints over
       it: the Sheet column's white cell, and whatever name or charge box
       happens to fall there, both drawn on top of the navy header band
       instead of underneath it.
       Bumping \`.ag-header\` itself does not reach far enough to fix this — it
       only wins the tie *inside* \`.ag-grid-pinned-top-rows\`, the sticky
       wrapper AG Grid already draws the header and this app's own pinned
       totals row inside; that wrapper's sibling on the scrolling side is
       \`.ag-grid-scrolling-rows\`, and it is those two that are actually
       compared once a descendant on either side asks for a stacking context.
       \`.ag-spanning-container\` (raised above) sits inside the scrolling
       side, several plain, uncontexted layers down, so its \`z-index: 2\`
       bubbles all the way up to that same comparison — landing exactly on
       \`.ag-grid-pinned-top-rows\`'s own default of \`2\`, a tie DOM order then
       breaks in the scrolling side's favour, since it is the later of the
       two in the document. Raising the pinned wrapper itself, rather than
       the header inside it, is what actually reaches that comparison. */
    :host ::ng-deep .ag-grid-pinned-top-rows {
      z-index: 3;
    }
  `,
})
export class SplitGrid {
  private readonly store = inject(TripStore);

  /**
   * AG Grid loses the renderer on a spanned cell whenever its block changes
   * size: the cell that covered the old block is destroyed with it, and the
   * one that takes its place comes back wrong — sometimes *empty*, an
   * `.ag-cell` with nothing inside; sometimes split across several un-merged
   * cells, each painting a fragment of the same sheet (its name on one row,
   * a charge box on another) instead of the one cell the block is supposed to
   * be. No error, no warning, either way.
   *
   * The same failure `onGridReady` works around, and the same fix: told to
   * paint again, the column resolves its renderer and the cell comes back.
   *
   * `onModelUpdated` — the grid's own signal that it has finished applying a
   * new set of rows — is the trigger rather than a guessed delay: a
   * `setTimeout` races the grid's own rendering and can fire before the new
   * row is actually in the DOM, which is exactly the gap this bug lives in.
   * {@link blockShape} still gates it, so a keystroke in a sheet's name box —
   * which also sends new row data down, just none that changes any block's
   * size — does not repaint the box being typed in.
   */
  protected onModelUpdated(): void {
    const shape = this.blockShape();
    if (shape === this.lastRefreshedShape) {
      return;
    }
    this.lastRefreshedShape = shape;
    this.api?.refreshCells({ columns: ['sheet'], force: true });
  }

  private lastRefreshedShape: string | null = null;

  /** How many lines each sheet has, as one string — see {@link onModelUpdated}. */
  private readonly blockShape = computed(() =>
    this.store.sheets().map((sheet) => sheet.items.length).join(','),
  );

  protected readonly theme = ledgerTheme;

  /** Shared with the Sheet cell, which has to size a spanned block itself. */
  protected readonly rowHeight = LEDGER_ROW_HEIGHT;

  /**
   * Every row is one line tall except the filler row that closes a short
   * block, which is as many as {@link LedgerFillerRow.rows} says — the padding
   * a block needs collapsed into one row rather than spread across several
   * identical ones. AG Grid calls this per row in place of the flat
   * `rowHeight` once it is supplied.
   */
  protected readonly getRowHeight = (params: RowHeightParams<LedgerRowData>): number => {
    if (params.data?.kind === 'filler') {
      return params.data.rows * LEDGER_ROW_HEIGHT;
    }
    // The balances row turns its person cells on their side to match the
    // header above them (see the `.ledger-balances-row .ledger-share` rule
    // below) — 20 extra pixels over the ordinary row height is the room that
    // sideways text needs so a longer balance does not clip.
    return params.data?.kind === 'balances' ? LEDGER_ROW_HEIGHT + 20 : LEDGER_ROW_HEIGHT;
  };

  /**
   * Which lines are ticked is AG Grid's; the ticking is not.
   *
   * `checkboxes` is off because AG Grid draws them only in a selection column
   * it prepends to the column list on every rebuild — it cannot sit after Sheet
   * and the line number. `enableClickSelection` is off for the same reason a
   * plain cell click cannot tick a line either: a click in the grid starts a
   * *cell* block for copy and paste, which is a different thing from choosing
   * lines to act on, and one click cannot mean both. The line number column is
   * the exception — it holds no pasteable value, so a click there is free to
   * mean "tick this line" instead, and {@link onCellMouseDown} handles it
   * directly, writing back through the node the same way the old boxes did.
   * `headerCheckbox` is off for the same reason, and {@link IndexHeader} is
   * what "tick every line" moved to.
   */
  protected readonly rowSelection: RowSelectionOptions<LedgerRowData> = {
    mode: 'multiRow',
    checkboxes: false,
    headerCheckbox: false,
    enableClickSelection: false,
    enableSelectionWithoutKeys: false,
    /**
     * Only the lines can be ticked. The blank row that ends a block is not a
     * line yet, and the pinned strip is a result; there is nothing to do to
     * either of them here.
     *
     * It belongs *inside* this object: given `rowSelection` as options rather
     * than a bare mode string, AG Grid reads `isRowSelectable` from here and
     * ignores the grid option of the same name, silently.
     */
    isRowSelectable: (node) => node.data?.kind === 'item',
  };

  /** The sheet whose settings panel is open, or null. */
  protected readonly editingSheetId = signal<string | null>(null);

  /** The block of cells a copy or a paste applies to, or null. */
  private readonly selection = signal<CellRange | null>(null);

  /** True between mousedown on a cell and the mouseup that ends the drag. */
  protected dragging = false;

  /**
   * True between mousedown on the fill handle and the mouseup that ends that
   * drag — a different thing from {@link dragging}: this one leaves
   * {@link selection} alone as the block being repeated, and grows a second
   * rectangle, {@link fillPreview}, out from its corner instead.
   */
  protected fillDragging = false;

  /** Where the fill handle is being dragged to, while {@link fillDragging}. */
  private readonly fillPreview = signal<CellRef | null>(null);

  private api: GridApi | null = null;

  protected onGridReady(event: GridReadyEvent): void {
    this.api = event.api;

    // Hands the grid back the column definitions it already has.
    //
    // A no-op in principle, and load-bearing in practice. When AG Grid first
    // takes these definitions it does not resolve `cellRenderer` at all — not
    // the Angular components, not even a plain function — so the Sheet and
    // actions cells come up *empty*, with no error and no warning, while the
    // plain-value columns beside them render normally. Re-applying the merged
    // definitions from `getColumnDefs()` rebuilds the columns and the
    // renderers take.
    //
    // It has to be `getColumnDefs()` rather than `this.columns()`: given back
    // the definitions it was handed, AG Grid finds nothing changed and skips
    // the rebuild. And it has to be deferred — run inside this handler it is
    // still too early. `firstDataRendered`, the obvious hook, never fires when
    // the grid is created with its rows already in place.
    setTimeout(() => {
      const api = this.api;
      if (api && !api.isDestroyed()) {
        api.setGridOption('columnDefs', api.getColumnDefs());
      }
    });
  }

  /**
   * Re-applies the columns the grid already has.
   *
   * A pure no-op in principle, and load-bearing in practice: when AG Grid first
   * takes the definitions it cannot yet resolve an Angular `cellRenderer`, so
   * the Sheet and actions cells come up *empty* — no error, no warning, and the
   * plain-value columns beside them render fine, which makes it look like a
   * problem with those two components. Handing the same definitions back once
   * the first rows are on screen is what makes the renderers take.
   *
   * `firstDataRendered` fires once per load of data, so this costs one extra
   * column pass on start-up and nothing thereafter.
   */
  protected closeEditor(): void {
    this.editingSheetId.set(null);
  }

  /** Adds a sheet and opens it, so it can be named straight away. */
  protected addSheet(): void {
    this.editingSheetId.set(this.store.addSheet().id);
  }

  /**
   * Adds a person and scrolls the new column into view.
   *
   * Columns are virtualised horizontally, so once a trip has a few people the
   * column this button creates is off the right-hand edge: pressed with nothing
   * visibly happening, the button looks broken. The scroll is what shows the
   * work.
   *
   * Deferred by a task because the column does not reach AG Grid's column model
   * until it has processed the new definitions. Naming happens in the header
   * itself — focusing it from here does not survive AG Grid rebuilding the
   * header it has just built.
   *
   * The new column lands *before* the trailing Add-person column in both the
   * grid's own model and {@link columns} — but not always in the header DOM,
   * which is the same staleness {@link onColumnMoved} works around: told to
   * insert a column ahead of one already there, AG Grid updates its column
   * model straight away and leaves the header cells themselves in the old
   * order until something asks them to repaint. One deferred `refreshHeader`
   * call — the same task the column model itself needed to be ready for —
   * lands too early to fix it here; the model is ready but the header's own
   * DOM apparently is not. A second, later one is what actually takes.
   */
  protected addPerson(): void {
    const colId = `person:${this.store.addPerson().id}`;
    setTimeout(() => {
      this.api?.ensureColumnVisible(colId);
      this.api?.refreshHeader();
      setTimeout(() => this.api?.refreshHeader());
    });
  }

  /**
   * Carries a person's column drag back into the trip's own order.
   *
   * AG Grid's column order is its own state — dropped there, it would hold
   * only until {@link columns} next rebuilds from {@link TripStore.people},
   * which draws every person column back in the store's order and undoes the
   * drag. So the drop is read back out here instead: once it settles
   * (`finished`), the store's order is replaced with whatever order the
   * person columns are actually in, and {@link columns} rebuilding from that
   * is what makes the drag stick.
   *
   * Fires for every column AG Grid moves, but `suppressMovable` on
   * {@link defaultColDef} keeps every column but a person's from moving in
   * the first place, so only a person column's own event ever reaches here
   * with something to do.
   *
   * The header cells themselves are the other half of the same staleness
   * `onGridReady` and `onModelUpdated` already work around: told to move a
   * column, AG Grid updates its own column model straight away but leaves the
   * header DOM sitting in the old order until something asks it to repaint.
   * Deferred for the same reason {@link addPerson}'s scroll is — this runs
   * inside the `columnMoved` handler, before the store's write has reached
   * {@link columns} and been rebound as `columnDefs`.
   */
  protected onColumnMoved(event: ColumnMovedEvent<LedgerRowData>): void {
    const colId = event.column?.getColId();
    if (!event.finished || !colId?.startsWith('person:')) {
      return;
    }
    const personId = colId.slice('person:'.length);
    const order = (this.api?.getAllGridColumns() ?? [])
      .map((column) => column.getColId())
      .filter((id) => id.startsWith('person:'))
      .map((id) => id.slice('person:'.length));
    const from = this.store.people().findIndex((p) => p.id === personId);
    const to = order.indexOf(personId);
    if (from >= 0 && to >= 0 && from !== to) {
      this.store.movePerson(personId, to - from);
      setTimeout(() => this.api?.refreshHeader());
    }
  }

  // --- Selecting a block of cells, and the clipboard ---------------------
  //
  // Both are Enterprise in AG Grid, so both are done here. The rectangle lives
  // in `cell-range.ts`; what follows is the grid's half of it — turning cell
  // events into corners, painting the block, and reading and writing the
  // tab-separated text a spreadsheet puts on the clipboard.

  /**
   * The columns a selection can cover, in the order they are drawn.
   *
   * An allow-list rather than a list of exceptions, so a column added later is
   * left out until someone decides it holds a value worth pasting. The tick box,
   * the line number and the spanned sheet heading are all things you read or
   * press, not things you would paste over. The index into *this* list is a
   * cell's `col` — see {@link CellRef}.
   */
  private readonly selectableColumns = computed<string[]>(() =>
    this.columns()
      .map((column) => column.colId!)
      .filter((colId) => colId === 'item' || colId === 'amount' || colId.startsWith('person:')),
  );

  protected onCellMouseDown(event: CellMouseDownEvent<LedgerRowData>): void {
    // The line number column holds no pasteable value, so a click there ticks
    // the line instead of starting a cell block — the same job the removed
    // checkbox column used to do, just moved onto a column that already has
    // its own reason to be clicked.
    if (event.column.getColId() === 'index') {
      if (event.node.data?.kind === 'item') {
        event.node.setSelected(!event.node.isSelected());
      }
      return;
    }
    const ref = this.cellRef(event.node, event.column.getColId());
    if (!ref) {
      this.select(null);
      return;
    }
    if (this.isFillHandleTarget(event)) {
      this.startFill(event.node, event.column.getColId());
      return;
    }
    // Shift keeps the anchor where it was, which is how you widen a selection
    // without dragging the whole way back.
    const anchor = ((event.event as MouseEvent | null)?.shiftKey && this.selection()?.anchor) || ref;
    this.select({ anchor, head: ref });
    this.dragging = true;
  }

  protected onCellMouseOver(event: CellMouseOverEvent<LedgerRowData>): void {
    const ref = this.cellRef(event.node, event.column.getColId());
    if (this.fillDragging) {
      if (ref) {
        this.fillPreview.set(ref);
        this.api?.refreshCells({ columns: this.selectableColumns(), force: true });
      }
      return;
    }
    const anchor = this.selection()?.anchor;
    if (!this.dragging || !anchor) {
      return;
    }
    if (ref) {
      this.select({ anchor, head: ref });
    }
  }

  protected endDrag(): void {
    if (this.fillDragging) {
      this.fillDragging = false;
      // Guaranteed by how `fillDragging` is set in the first place —
      // {@link startFill} never runs without a selection to drag the handle
      // off of, and it seeds `fillPreview` with that same cell.
      const base = rangeBounds(this.selection()!);
      const target = this.fillPreview()!;
      this.fillPreview.set(null);
      this.fill(base, target);
      return;
    }
    this.dragging = false;
  }

  /**
   * Starts dragging the fill handle out from the selection's own corner.
   *
   * Takes a node and a column id — the same shape {@link onCellMouseDown}
   * itself is handed — rather than a bare {@link CellRef}, so a test can call
   * it exactly the way it calls that, without also having to reproduce
   * {@link cellRef}'s own arithmetic.
   *
   * Split out so the part with a rule in it — where the drag ends up, and
   * what it copies — can be called directly, the same way
   * {@link onCellMouseDown} itself is; {@link isFillHandleTarget}, the part
   * that decides whether a mousedown landed on the handle at all, is real
   * pixel geometry with nothing to unit-test.
   */
  protected startFill(node: IRowNode<LedgerRowData>, colId: string): void {
    const ref = this.cellRef(node, colId);
    // Guards the invariant `endDrag` leans on below: `fillDragging` is never
    // true without a selection for the fill to have come from.
    if (ref && this.selection()) {
      this.fillDragging = true;
      this.fillPreview.set(ref);
    }
  }

  /**
   * Extends the base selection toward wherever the handle was dropped and, if
   * that grew the rectangle, repeats its pattern into the new cells — the
   * same tiling a paste does, just starting from whichever edge was dragged
   * past instead of always the top-left. The selection grows to cover the
   * filled cells too, the way a spreadsheet leaves it after a fill.
   */
  private fill(base: RangeBounds, target: CellRef): void {
    const extended = extendRange(base, target);
    const grew =
      extended.top !== base.top ||
      extended.bottom !== base.bottom ||
      extended.left !== base.left ||
      extended.right !== base.right;
    if (!grew) {
      // Dropped back inside the selection: nothing to fill, but the preview's
      // dashed outline still needs clearing.
      this.api?.refreshCells({ columns: this.selectableColumns(), force: true });
      return;
    }
    this.applyFill(base, extended);
    this.select({
      anchor: { row: extended.top, col: extended.left },
      head: { row: extended.bottom, col: extended.right },
    });
  }

  /**
   * Writes the base block's values into the cells the fill grew into,
   * repeating it the way a paste repeats the clipboard — through the same
   * `valueSetter` typing goes through, so a fill is held to the same rules.
   */
  private applyFill(base: RangeBounds, extended: RangeBounds): void {
    const api = this.api;
    if (!api) {
      return;
    }
    const columns = this.selectableColumns();
    const baseWidth = base.right - base.left + 1;
    const baseHeight = base.bottom - base.top + 1;

    // Read the base block once, before writing anything — every store call
    // below replaces the trip, and reading mid-fill would pick up values this
    // same fill just wrote.
    const source: (string | null)[][] = [];
    for (let row = base.top; row <= base.bottom; row++) {
      const node = api.getDisplayedRowAtIndex(row);
      const line: (string | null)[] = [];
      for (let col = base.left; col <= base.right; col++) {
        const value = node ? api.getCellValue({ rowNode: node, colKey: columns[col] }) : null;
        line.push(value == null ? null : String(value));
      }
      source.push(line);
    }

    for (let row = extended.top; row <= extended.bottom; row++) {
      const node = api.getDisplayedRowAtIndex(row);
      // Clipped to the lines that exist, the same as a paste: a fill spreads
      // a sheet's own pattern over its own lines, not into the blank row that
      // ends the block or a neighbouring sheet's heading.
      if (node?.data?.kind !== 'item') {
        continue;
      }
      const srcRow = (((row - base.top) % baseHeight) + baseHeight) % baseHeight;
      for (let col = extended.left; col <= extended.right; col++) {
        if (row >= base.top && row <= base.bottom && col >= base.left && col <= base.right) {
          continue; // Already holds this value — it is the source.
        }
        const srcCol = (((col - base.left) % baseWidth) + baseWidth) % baseWidth;
        const value = source[srcRow][srcCol];
        if (value !== null) {
          node.setDataValue(columns[col], value);
        }
      }
    }
  }

  /**
   * True for the one cell at the current selection's own bottom-right
   * corner — the only place the handle is drawn, in {@link columns} below.
   *
   * Held to a line, the same as {@link applyFill} itself is: the "add" row
   * and the filler beneath a short block are not lines to fill from or into,
   * only padding and a place to type a new one. A selection that reaches down
   * into either has its corner *on* one of them — the last row of a block
   * always is — so this is also what keeps the handle from being drawn at
   * all once a drag has swept either one up.
   */
  private isFillHandle(node: IRowNode<LedgerRowData>, colId: string): boolean {
    const range = this.selection();
    if (!range || node.data?.kind !== 'item') {
      return false;
    }
    const { bottom, right } = rangeBounds(range);
    const ref = this.cellRef(node, colId);
    return !!ref && ref.row === bottom && ref.col === right;
  }

  /**
   * True for a cell inside the block a fill drag is about to cover, but not
   * already inside the selection it started from — that block stays marked
   * {@link isSelected} throughout, so the two together are what draw the
   * whole preview.
   *
   * Excludes the "add" row and the filler beneath a short block for the same
   * reason {@link isFillHandle} does: dragging the handle past either into
   * one would otherwise dash a promise {@link applyFill} does not keep, since
   * it already skips writing to a line that is not one.
   */
  private isFillPreview(node: IRowNode<LedgerRowData>, colId: string): boolean {
    if (!this.fillDragging || node.data?.kind !== 'item') {
      return false;
    }
    const base = this.selection();
    const target = this.fillPreview();
    const ref = base && target && this.cellRef(node, colId);
    if (!base || !target || !ref) {
      return false;
    }
    const extended = extendRange(rangeBounds(base), target);
    return (
      ref.row >= extended.top &&
      ref.row <= extended.bottom &&
      ref.col >= extended.left &&
      ref.col <= extended.right &&
      !rangeHas(base, ref.row, ref.col)
    );
  }

  /**
   * True when a mousedown landed on the little square at the selection's own
   * corner rather than on the cell around it — real pixel geometry, with
   * nothing in it to unit-test; the drag it starts, {@link startFill}, is
   * tested directly instead.
   */
  private isFillHandleTarget(event: CellMouseDownEvent<LedgerRowData>): boolean {
    if (!this.isFillHandle(event.node, event.column.getColId())) {
      return false;
    }
    const native = event.event as MouseEvent | null;
    const cell = (native?.target as HTMLElement | null)?.closest('.ag-cell');
    if (!native || !cell) {
      return false;
    }
    const rect = cell.getBoundingClientRect();
    const HANDLE_HIT_PX = 8;
    return native.clientX >= rect.right - HANDLE_HIT_PX && native.clientY >= rect.bottom - HANDLE_HIT_PX;
  }

  // --- Ticked lines, and what can be done to them ------------------------
  //
  // These used to be three buttons on every row, in a column that carried them
  // the whole length of the trip to be used on one line at a time. Ticking the
  // lines and acting on them once gives the width back and works on a phone,
  // where a row of buttons per line was unusable.

  /** The lines that are ticked, in ledger order. */
  protected readonly ticked = signal<LedgerItemRow[]>([]);

  protected onSelectionChanged(event: SelectionChangedEvent<LedgerRowData>): void {
    const lines: LedgerItemRow[] = [];
    for (const node of event.api.getSelectedNodes()) {
      if (node.data?.kind === 'item') {
        lines.push(node.data);
      }
    }
    this.ticked.set(lines);

    // The highlight is drawn by `cellClassRules` on the line number column,
    // which AG Grid only re-runs when told the cells changed — a tick can be
    // dropped by a removal without the cell that draws it hearing anything.
    event.api.refreshCells({ columns: ['index'], force: true });
    event.api.refreshHeader();
  }

  protected removeTicked(): void {
    for (const line of this.tickedItems()) {
      this.store.removeItem(line.sheetId, line.itemId);
    }
    this.api?.deselectAll();
  }

  protected splitTickedEvenly(): void {
    for (const line of this.tickedItems()) {
      this.store.splitItemEvenly(line.itemId);
    }
  }

  protected clearTickedShares(): void {
    for (const line of this.tickedItems()) {
      this.store.clearItemShares(line.itemId);
    }
  }

  /**
   * The ticked lines as plain ids, read once before any of them is written to:
   * every store call replaces the trip, and the row data held by the tick would
   * be from the trip before it.
   */
  private tickedItems(): { sheetId: string; itemId: string }[] {
    return this.ticked().map((line) => ({ sheetId: line.sheetId, itemId: line.row.item.id }));
  }

  /**
   * Where a cell sits in the selectable grid, or null if it is not one.
   *
   * The pinned summary strip is not: it holds results rather than entries, so
   * there is nothing there to paste over.
   */
  private cellRef(node: IRowNode<LedgerRowData>, colId: string): CellRef | null {
    const col = this.selectableColumns().indexOf(colId);
    if (col < 0 || node.rowPinned || node.rowIndex == null) {
      return null;
    }
    return { row: node.rowIndex, col };
  }

  /**
   * Moves the selection and repaints it.
   *
   * The repaint is explicit because the block is drawn by a `cellClassRules`
   * entry, and AG Grid only re-runs those when it is told the cells changed —
   * the underlying values have not.
   */
  private select(range: CellRange | null): void {
    this.selection.set(range);
    this.api?.refreshCells({ columns: this.selectableColumns(), force: true });
  }

  private isSelected(node: IRowNode<LedgerRowData>, colId: string): boolean {
    const range = this.selection();
    const ref = range && this.cellRef(node, colId);
    return !!range && !!ref && rangeHas(range, ref.row, ref.col);
  }

  /**
   * Copies the selected block as the tab-separated text every spreadsheet
   * speaks — raw values, not formatted ones, so what comes back on a paste is
   * what was there.
   */
  protected onCopy(event: ClipboardEvent): void {
    const api = this.api;
    const range = this.selection();
    if (!api || !range || isTyping(event.target)) {
      return;
    }
    const columns = this.selectableColumns();
    const { top, left, bottom, right } = rangeBounds(range);

    const rows: string[][] = [];
    for (let row = top; row <= bottom; row++) {
      const node = api.getDisplayedRowAtIndex(row);
      const line: string[] = [];
      for (let col = left; col <= right; col++) {
        const value = node ? api.getCellValue({ rowNode: node, colKey: columns[col] }) : null;
        line.push(value == null ? '' : String(value));
      }
      rows.push(line);
    }

    event.clipboardData?.setData('text/plain', toClipboardText(rows));
    event.preventDefault();
  }

  /**
   * Writes the clipboard into the selected block.
   *
   * Every cell goes through the column's own `valueSetter`, so a paste is held
   * to exactly the rules typing is: a share outside 0 – 10 is refused, an
   * amount that is not a number is dropped, and the store is the only thing
   * written to.
   */
  protected onPaste(event: ClipboardEvent): void {
    const api = this.api;
    const range = this.selection();
    const text = event.clipboardData?.getData('text/plain');
    if (!api || !range || !text || isTyping(event.target)) {
      return;
    }
    event.preventDefault();

    const block = fromClipboardText(text);
    const columns = this.selectableColumns();
    const { top, left, bottom, right } = rangeBounds(range);

    // One selected cell means "start here"; a block of them is the extent to
    // fill, repeating the clipboard as a spreadsheet does — which is what makes
    // one value paste across many rows.
    const width = Math.max(...block.map((line) => line.length));
    const lastRow = isSingleCell(range) ? top + block.length - 1 : bottom;
    const lastCol = isSingleCell(range) ? left + width - 1 : right;

    for (let row = top; row <= lastRow; row++) {
      const node = api.getDisplayedRowAtIndex(row);
      // Clipped to the lines that exist: a paste fills a sheet, it does not
      // grow one. The blank row at the end of a block is left to be typed on.
      if (node?.data?.kind !== 'item') {
        continue;
      }
      const line = block[(row - top) % block.length];
      for (let col = left; col <= lastCol && col < columns.length; col++) {
        const value = line[(col - left) % line.length];
        if (value !== undefined) {
          node.setDataValue(columns[col], value);
        }
      }
    }
  }

  protected readonly defaultColDef: ColDef<LedgerRowData> = {
    // Every column here is sized for exactly what it holds — a tick, a line
    // number, a share of at most four characters — and Item takes whatever is
    // left over. There is nothing resizing could improve, and a grab handle on
    // every border is one more thing to catch on the way to a cell.
    resizable: false,
    sortable: false,
    filter: false,
    // Fixed by default — Sheet, the tick box and the line number are what the
    // ledger is grouped and read by, and Item/Amount are the two everything
    // else lines up under. A person column overrides this back to movable
    // (see below): reordering people *is* a drag now, not a pair of arrows.
    suppressMovable: true,
    // Every column here says what it holds through its own valueGetter and
    // renderer. Left on, AG Grid infers a type per column from the row data —
    // and the rows are a union of four shapes, so what it infers is noise.
    cellDataType: false,
  };

  protected readonly rows = computed<LedgerRowData[]>(() =>
    buildLedgerRows(this.store.split().rows, this.store.sheets()),
  );

  /**
   * The summary strip, pinned so the answer stays on screen while the rows
   * scroll: each person's balance under their column, the trip total under
   * Amount. Its cells read the store directly, so this only has to produce a
   * fresh array whenever either figure moves — otherwise AG Grid, seeing the
   * same reference, leaves the pinned row showing the old numbers.
   */
  protected readonly pinnedTop = computed<LedgerRowData[]>(() => {
    this.store.balances();
    this.store.grandTotal();
    return [{ kind: 'balances' }];
  });

  protected readonly columns = computed<ColDef<LedgerRowData>[]>(() => {
    const people = this.store.people();
    const baseSymbol = this.store.baseSymbol();

    // Sheet leads, because it is what the rows are grouped under: the block
    // heading belongs at the edge the eye starts from, with the line numbers it
    // covers beside it rather than outside it.
    const columns: ColDef<LedgerRowData>[] = [
      {
        colId: 'sheet',
        // No header *text*: the cell's boxes are turned on their side
        // (`sheet-cell.ts`) and the column is now too narrow for a label that is
        // not. The names running down it are the label, which leaves the header
        // free for the button that makes one.
        headerName: '',
        headerComponent: AddSheetHeader,
        headerComponentParams: { addSheet: () => this.addSheet() },
        headerClass: 'ledger-sheet-header',
        // Three lines of sideways text and the room around them, measured
        // rather than guessed: the name box, the charges and the "Paid by"
        // caption come to 63 across, plus the cell's padding and borders.
        width: 70,
        cellRenderer: SheetCell,
        cellClass: 'ledger-sheet-cell',
        // What makes a sheet a block: adjacent rows sharing this value are
        // drawn as one spanned cell. AG Grid's own row grouping is Enterprise.
        spanRows: true,
        valueGetter: (p: ValueGetterParams<LedgerRowData>) =>
          p.data && 'sheetId' in p.data ? p.data.sheetId : NO_SHEET,
        // Not `editable`: AG Grid refuses it on a spanned column and drops the
        // cell altogether. The renderer opens {@link SheetEditor} instead.
        editable: false,
        cellRendererParams: {
          openEditor: (sheetId: string) => this.editingSheetId.set(sheetId),
        },
      },
      {
        colId: 'index',
        headerName: '#',
        headerComponent: IndexHeader,
        width: 45,
        editable: false,
        // Derived, so it is not part of a copy: pasting a line number over
        // another line would mean nothing.
        cellClass: (p) => (p.data?.kind === 'item' ? 'ledger-index ledger-index-tickable' : 'ledger-index'),
        cellClassRules: {
          'ledger-index-ticked': (p) => p.node.isSelected() ?? false,
        },
        valueGetter: (p: ValueGetterParams<LedgerRowData>) =>
          p.data?.kind === 'item' ? p.data.index : '',
      },
      {
        colId: 'item',
        headerName: 'Item',
        flex: 1,
        minWidth: 150,
        editable: (p) => p.data?.kind === 'item' || p.data?.kind === 'add-item',
        valueGetter: (p: ValueGetterParams<LedgerRowData>) =>
          p.data?.kind === 'item' ? p.data.row.item.name : '',
        valueFormatter: (p) => (p.data?.kind === 'add-item' ? '+ Add item' : (p.value ?? '')),
        valueSetter: (p: ValueSetterParams<LedgerRowData>) =>
          this.setItemField(p, (sheetId, itemId) =>
            this.store.updateItem(sheetId, itemId, { name: String(p.newValue ?? '') }),
          ),
        cellClassRules: {
          'ledger-missing': (p) =>
            p.data?.kind === 'item' && this.itemHasError(p.data.row.item.id),
          'ledger-selected': (p) => this.isSelected(p.node, 'item'),
          'ledger-fill-handle': (p) => this.isFillHandle(p.node, 'item'),
          'ledger-fill-preview': (p) => this.isFillPreview(p.node, 'item'),
        },
      },
      {
        colId: 'amount',
        headerName: `Amount (${this.sheetCurrencyHeader()})`,
        width: 150,
        type: 'numericColumn',
        // \`numericColumn\` right-aligns its header text along with the cell
        // values; the values should stay that way (a column of money reads
        // by its ones place), but the title reads better flush with the
        // columns beside it. An explicit \`headerClass\` replaces the type's
        // own rather than adding to it, so the cell values keep their own
        // right alignment only because \`ledger-numeric\`/\`ledger-total\`,
        // below, set it independently.
        headerClass: 'ledger-amount-header',
        editable: (p) => p.data?.kind === 'item' || p.data?.kind === 'add-item',
        valueGetter: (p: ValueGetterParams<LedgerRowData>) => {
          // The trip total rides the pinned strip, under this column's own
          // header — the same place a person's balance sits under theirs. It
          // needs no label of its own: the header names the column, and the
          // figure is the only one on the row not attached to a person.
          if (p.data?.kind === 'balances') {
            return this.store.grandTotal();
          }
          return p.data?.kind === 'item' ? p.data.row.item.amount : null;
        },
        // Money on the way out, a plain number on the way in. A formatter only
        // ever draws the *resting* cell — AG Grid hands the editor the raw
        // value — so the symbol and separators are there to read and gone the
        // moment you type over them.
        //
        // In the sheet's own currency, not the trip's: this column carries
        // whatever each block was billed in, which is why its header falls back
        // to naming no currency at all when the sheets disagree.
        valueFormatter: (p) => {
          if (p.data?.kind === 'balances') {
            return money.transform(p.value, baseSymbol);
          }
          return p.data?.kind === 'item' ? money.transform(p.value, this.symbolForRow(p.data)) : '';
        },
        cellClass: (p) =>
          p.data?.kind === 'balances' ? 'ledger-numeric ledger-total' : 'ledger-numeric',
        valueSetter: (p: ValueSetterParams<LedgerRowData>) => {
          const amount = parseAmount(p.newValue);
          return this.setItemField(p, (sheetId, itemId) =>
            this.store.updateItem(sheetId, itemId, { amount }),
          );
        },
        cellClassRules: {
          'ledger-selected': (p) => this.isSelected(p.node, 'amount'),
          'ledger-fill-handle': (p) => this.isFillHandle(p.node, 'amount'),
          'ledger-fill-preview': (p) => this.isFillPreview(p.node, 'amount'),
        },
      },
    ];

    for (const person of people) {
      columns.push({
        colId: `person:${person.id}`,
        // The name lives in the header component, which is also where it is
        // edited; this is only what screen readers and menus fall back to.
        headerName: person.name || 'Unnamed',
        headerComponent: PersonHeader,
        headerComponentParams: { personId: person.id },
        headerClass: 'ledger-person-header',
        width: 44,
        // The one column left movable — reordering people is a drag on their
        // own header now, not a pair of arrows. {@link onColumnMoved} is what
        // carries the drop back into the trip's own order.
        suppressMovable: false,
        cellClass: 'ledger-share',
        editable: (p) => p.data?.kind === 'item',
        valueGetter: (p: ValueGetterParams<LedgerRowData>) => {
          if (p.data?.kind === 'balances') {
            return this.balanceOf(person.id);
          }
          return p.data?.kind === 'item'
            ? packShare(this.store.share(p.data.row.item.id, person.id))
            : null;
        },
        // A balance is money and reads like the trip total above it, symbol and
        // all. A share is a ratio and is left exactly as typed — putting a
        // currency symbol on `1.2` would be a lie about what it means.
        valueFormatter: (p) => {
          if (p.data?.kind === 'balances') {
            return money.transform(p.value, baseSymbol);
          }
          return p.value == null ? '' : String(p.value);
        },
        valueSetter: (p: ValueSetterParams<LedgerRowData>) => {
          if (p.data?.kind !== 'item') {
            return false;
          }
          const share = parseShare(p.newValue);
          if (share === null) {
            // Outside the workbook's 0–10 validation: keep what was there.
            return false;
          }
          this.store.setShare(p.data.row.item.id, person.id, share);
          return true;
        },
        cellClassRules: {
          'ledger-paid': (p) => p.data?.kind === 'item' && this.isPayer(p.data, person.id),
          'ledger-missing': (p) =>
            p.data?.kind === 'item' && isRowUnassigned(p.data.row),
          'ledger-credit': (p) =>
            p.data?.kind === 'balances' && this.balanceOf(person.id) < 0,
          'ledger-selected': (p) => this.isSelected(p.node, `person:${person.id}`),
          'ledger-fill-handle': (p) => this.isFillHandle(p.node, `person:${person.id}`),
          'ledger-fill-preview': (p) => this.isFillPreview(p.node, `person:${person.id}`),
        },
      });
    }

    // The trailing column that adds a person — see `person-header.ts` for
    // why this is a column rather than the toolbar button it used to be.
    // Fixed, not `movable`: a person's own column is what drags, not the
    // button that makes one, the same way Sheet's own `+` never moves either.
    columns.push({
      colId: 'add-person',
      headerName: '',
      headerComponent: AddPersonHeader,
      headerComponentParams: { addPerson: () => this.addPerson() },
      headerClass: 'ledger-person-header',
      cellClass: 'ledger-add-person-cell',
      width: 44,
      editable: false,
    });

    return columns;
  });

  protected readonly getRowId = (params: GetRowIdParams<LedgerRowData>): string =>
    ledgerRowId(params.data);

  protected readonly getRowClass = (params: RowClassParams<LedgerRowData>): string => {
    switch (params.data?.kind) {
      case 'add-item':
        return 'ledger-add-row';
      case 'filler':
        return 'ledger-filler-row';
      case 'balances':
        return 'ledger-balances-row';
      default:
        return '';
    }
  };

  /**
   * Writes a field of an item, creating the item first when the edit landed on
   * a sheet's "add" row — which is what makes typing on the blank line at the
   * bottom of a block add a row, the way a spreadsheet does.
   */
  private setItemField(
    params: ValueSetterParams<LedgerRowData>,
    write: (sheetId: string, itemId: string) => void,
  ): boolean {
    const data = params.data;
    if (data?.kind === 'item') {
      write(data.sheetId, data.row.item.id);
      return true;
    }
    if (data?.kind === 'add-item') {
      const value = params.newValue;
      if (value === null || value === undefined || String(value).trim() === '') {
        return false;
      }
      const item = this.store.addItem(data.sheetId);
      write(data.sheetId, item.id);
      return true;
    }
    return false;
  }

  /**
   * The Amount column is in each *sheet's* own currency, which can differ from
   * row to row, so the header names the base currency only when every sheet
   * agrees with it. Per-row currency is shown by the sheet's own cell.
   */
  private sheetCurrencyHeader(): string {
    const symbols = new Set(this.store.sheets().map((s) => this.store.symbolFor(s)));
    return symbols.size === 1 ? [...symbols][0] : 'sheet ccy';
  }

  /** The symbol a row's amount is in — its sheet's, which need not be the trip's. */
  private symbolForRow(data: LedgerRowData): string {
    const sheet =
      'sheetId' in data ? this.store.sheets().find((s) => s.id === data.sheetId) : undefined;
    return sheet ? this.store.symbolFor(sheet) : this.store.baseSymbol();
  }

  private balanceOf(personId: string): number {
    return this.store.balances().find((b) => b.personId === personId)?.balance ?? 0;
  }

  private isPayer(data: { row: { item: { id: string } } } & LedgerRowData, personId: string): boolean {
    if (data.kind !== 'item') {
      return false;
    }
    if (data.row.usesSheetPayers) {
      return data.row.sheetPayerIds.includes(personId);
    }
    return this.store.share(data.row.item.id, personId).pay > 0;
  }

  private itemHasError(itemId: string): boolean {
    return this.store
      .issues()
      .some((i) => i.itemId === itemId && i.severity === 'error');
  }
}

/**
 * True when the copy or paste belongs to something being typed in — a cell
 * editor, or the name box in a person's header. Those get the clipboard the way
 * any text box does, and the grid must keep its hands off.
 */
function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}

/** A priced row nobody has claimed a share of — the workbook's red cells. */
function isRowUnassigned(row: { item: { amount: number | null }; lineTotal: number; unitCost: number | null }): boolean {
  return row.item.amount != null && row.lineTotal !== 0 && row.unitCost === null;
}

function parseAmount(value: unknown): number | null {
  const raw = String(value ?? '').trim();
  if (raw === '') {
    return null;
  }
  const amount = Number(raw.replace(/,/g, ''));
  return Number.isFinite(amount) ? amount : null;
}

/**
 * Parses a share cell, holding the workbook's data validation on the split
 * grid: 0 – 10, one decimal. Returns null for anything outside it.
 */
function parseShare(value: unknown): ReturnType<typeof unpackShare> | null {
  const raw = String(value ?? '').trim();
  if (raw === '') {
    return { owe: 0, pay: 0 };
  }
  const packed = Number(raw);
  if (!Number.isFinite(packed) || packed < 0 || packed > 10) {
    return null;
  }
  return unpackShare(packed);
}
