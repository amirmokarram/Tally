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
  DestroyRef,
  effect,
  ElementRef,
  inject,
  isDevMode,
  signal,
  viewChild,
} from '@angular/core';
import { AgGridAngular } from 'ag-grid-angular';
import {
  BodyScrollEvent,
  CellEditingStartedEvent,
  CellEditingStoppedEvent,
  CellFocusedEvent,
  CellSpanModule,
  CellStyleModule,
  ClientSideRowModelApiModule,
  ClientSideRowModelModule,
  CellApiModule,
  CellMouseDownEvent,
  CellMouseOverEvent,
  ColDef,
  ColSpanParams,
  ColumnApiModule,
  ColumnMovedEvent,
  ColumnResizedEvent,
  _ColumnMoveModule,
  EventApiModule,
  GetRowIdParams,
  GridApi,
  GridReadyEvent,
  IRowNode,
  _KeyboardNavigationModule,
  ModuleRegistry,
  NumberEditorModule,
  RenderApiModule,
  RowApiModule,
  RowClassParams,
  RowHeightParams,
  RowSelectionModule,
  RowSelectionOptions,
  ScrollApiModule,
  RowStyleModule,
  SelectionChangedEvent,
  SuppressKeyboardEventParams,
  SuppressNavigableCallback,
  TextEditorModule,
  ValidationModule,
  ValueGetterParams,
  ValueSetterParams,
} from 'ag-grid-community';

import { TripStore } from '../core/trip-store';
import { ReportSettings } from '../core/report-settings';
import { MoneyPipe } from '../core/money.pipe';
import { buildExportPayload, downloadJson, exportFileName } from '../core/trip-file';
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
import {
  DEFAULT_TOTALS_BAND_HEIGHT,
  LEDGER_ADD_ROW_HEIGHT,
  LEDGER_ROW_HEIGHT,
  ledgerTheme,
} from './grid-theme';
import { AddSheetHeader, SheetCell } from './sheet-cell';
import { SheetEditor } from './sheet-editor';
import { SheetReorderDialog } from './sheet-reorder-dialog';
import { SettingsPopup } from './settings-popup';
import { AddPersonHeader, PersonHeader } from './person-header';
import { IndexHeader } from './index-header';
import { CurrencyPicker } from './currency-picker';

// Community modules only, and named one by one rather than pulled in as
// `AllCommunityModule`: the bundle is shipped to a GitHub Pages demo, and the
// filtering, sorting, pagination, export and selection this grid does not use
// are most of AG Grid's weight.
//
// Registered once, at import, so the tests that create the component get the
// same grid the app does.
ModuleRegistry.registerModules([
  ClientSideRowModelModule,
  // `api.resetRowHeights()` — recomputes the add-item row's height when it
  // expands/collapses on focus. `ClientSideRowModelModule` alone doesn't
  // carry this; it is its own opt-in module.
  ClientSideRowModelApiModule,
  CellSpanModule, // the sheet blocks — AG Grid's own grouping is Enterprise
  CellStyleModule, // cellClass / cellClassRules
  RowStyleModule, // getRowClass
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
  // `(bodyScroll)` — keeps the totals band lined up with the grid's own
  // columns when there are enough people to scroll sideways.
  EventApiModule,
  // Dragging a person's own header to reorder it. The leading underscore is
  // AG Grid's own naming for a module carved out of what used to be part of
  // the free bundle — it ships from `ag-grid-community`, not `-enterprise`.
  _ColumnMoveModule,
  // `suppressNavigable` (keeps Tab/arrow keys off the filler beneath a short
  // block) and `api.clearFocusedCell()` (bounces a mouse click off the same
  // cells — see {@link SplitGrid.onCellFocused}). Leading underscore is AG
  // Grid's own naming, the same as `_ColumnMoveModule` above.
  _KeyboardNavigationModule,
  // Turns AG Grid's numbered warnings into readable ones. Dropped from the
  // production bundle, which is a large part of the saving.
  ...(isDevMode() ? [ValidationModule] : []),
]);

/** Marks the Sheet column's value on the row that adds a sheet. */
const NO_SHEET = '(no sheet)';

/**
 * How wide AG Grid's own vertical/horizontal scrollbars are drawn — passed
 * to the grid's `scrollbarWidth` option and, since the grid pads its
 * scrollable row content by this much again on the right so the (always-on)
 * vertical scrollbar never overlaps the last column, added a second time as
 * a trailing spacer in {@link SplitGrid.totalsColumns}. Without that second
 * copy the band runs out of room to scroll {@link GRID_SCROLLBAR_WIDTH}px
 * before the grid does, so at full scroll the two fall out of alignment.
 */
const GRID_SCROLLBAR_WIDTH = 10;

/**
 * The trailing add-person column's width — narrower than a person's own
 * 40-pixel column (set inline in {@link SplitGrid.columns}) since its header
 * holds only the add button's icon, not a rotated name. Fits the 26-pixel
 * button (see `person-header.ts`'s `AddPersonHeader`) with a pixel of
 * breathing room either side.
 */
const ADD_PERSON_COLUMN_WIDTH = 28;

/**
 * The app's money formatting — thousands separators, and a credit in
 * parentheses rather than behind a minus sign, which is how the spreadsheet
 * showed someone who is owed. Reused through the pipe class so the grid cannot
 * drift from the rest of the app.
 */
const money = new MoneyPipe();

@Component({
  selector: 'app-split-grid',
  imports: [AgGridAngular, SheetEditor, SheetReorderDialog, CurrencyPicker, MoneyPipe, SettingsPopup],
  templateUrl: './split-grid.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    // The clipboard events are taken on the host rather than on the document:
    // they reach here by bubbling from the focused cell, so a copy aimed at
    // something else on the page is left alone. Delete/Backspace ride the
    // same bubble for the same reason — see {@link onKeyDown}.
    '(copy)': 'onCopy($event)',
    '(paste)': 'onPaste($event)',
    '(keydown)': 'onKeyDown($event)',
    // A drag can end anywhere, including outside the grid.
    '(document:mouseup)': 'endDrag()',
    '(document:keydown.escape)': 'closeContextMenu()',
    // Not AG Grid's own `(cellContextMenu)` output — see {@link onContextMenu}
    // for why that one arrives too late to prevent anything.
    '(contextmenu)': 'onContextMenu($event)',
    '[class.dragging]': 'dragging || fillDragging',
    '[class.filling]': 'fillDragging',
    '[class.no-row-hover]': '!settings.rowHoverEnabled()',
  },
  styles: `
    /* Fills \`main\` exactly (see app.scss) rather than sizing itself off
       \`100vh\` — \`.report\` below stretches to match and hands its own
       leftover space to \`.grid\`, so the grid's body is the only thing that
       scrolls instead of the browser window. */
    :host {
      display: block;
      height: 100%;
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

    /* This block's own top edge, not a strip floating above it — same
       border and top corners as the totals band directly under it (which
       drops its own top border and radius to match, below), so toolbar,
       totals and grid read as one report rather than chrome sitting on a
       document. Still outside the totals band itself: that one scrolls
       horizontally with the grid's own columns, and controls that matter
       regardless of scroll position cannot live in a cell that might. */
    .report-toolbar {
      flex: none;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 5px 10px;
      background: var(--surface-alt);
      border: 1px solid var(--border);
      border-bottom: none;
      border-top-left-radius: var(--radius);
      border-top-right-radius: var(--radius);
      overflow: overlay;
      /* Queries the toolbar's own width, not the viewport's — so the
         buttons drop their labels exactly when *this* row runs out of
         room, whatever the reason (a narrow window, a sidebar, zoom). */
      container-type: inline-size;
    }

    .toolbar-group {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .toolbar-divider {
      width: 1px;
      height: 18px;
      background: var(--border-strong);
      margin-inline: 6px;
    }

    /* Icon plus label, matching the add-person / add-sheet buttons' own
       stroke-based icons rather than introducing a new visual language. */
    .toolbar-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 10px;
      border: 1px solid transparent;
      border-radius: var(--radius-sm);
      background: none;
      color: var(--text-muted);
      font-size: 13px;
      font-weight: 600;

      svg {
        flex: none;
      }

      &:hover {
        background: var(--navy-050);
        color: var(--navy-800);
      }

      &:disabled {
        opacity: 0.4;
        cursor: default;
        pointer-events: none;
      }
    }

    /* Below this, the row stops fitting labels-and-all — Reorder sheets is
       the longest, so it is what the threshold is tuned against. Icons
       alone still say what each button does (their own \`title\` carries the
       rest), and shedding the labels buys back exactly the width that was
       overflowing rather than wrapping the toolbar onto a second line. The
       currency picker is deliberately untouched: it is already as compact
       as it gets (see \`.currency-select\` below), and it is what the trip's
       numbers are in — not something to hide under pressure. */
    @container (max-width: 620px) {
      .toolbar-btn .btn-label {
        display: none;
      }

      .toolbar-btn {
        padding-inline: 8px;
      }
    }

    /* One block, one border, one shadow — the totals band and the grid below
       draw no edges of their own but the hairline between them, so the whole
       thing reads as a single report rather than stacked pieces of UI.
       A flex column filling the host: toolbar and totals band take their
       own content height, \`.grid\` takes whatever is left — see its own
       rule, below. No bottom margin: nothing sits under the report any
       more, and it would otherwise push the report past \`:host\`'s own
       height and force a scrollbar \`main\` never needed. */
    .report {
      display: flex;
      flex-direction: column;
      height: 100%;
      border-radius: var(--radius);
      box-shadow: 0 1px 2px rgb(20 53 95 / 8%), 0 4px 16px rgb(20 53 95 / 6%);
    }

    .masthead-title {
      flex: 1;
      min-width: 160px;
    }

    /* The split's own red message, read right where its name is — the
       thing being edited when it happened, not a banner elsewhere on the
       page. */
    .masthead-issue {
      margin: 3px 0 0;
      color: var(--credit);
      font-size: 14px;
      font-weight: 600;

      &.warning {
        color: var(--warn);
      }
    }

    /* A document's own title, not a form field — plain until it is reached
       for, the same way a person's name in its column header is. */
    .title-input {
      width: 100%;
      padding: 2px 0;
      border: none;
      border-bottom: 1px solid transparent;
      background: none;
      color: var(--text);
      font-size: 19px;
      font-weight: 650;
      letter-spacing: -0.01em;

      &::placeholder {
        color: var(--text-muted);
        font-weight: 400;
      }

      &:hover {
        border-bottom-color: var(--border-strong);
      }

      &:focus {
        outline: none;
        border-bottom-color: var(--navy-700);
      }
    }

    /* The picker paints itself, compact now that it is a symbol and a code
       rather than the full "(USD) US Dollar" line — its own width is enough. */
    .currency-select {
      flex: none;
    }

    /* The report's own top line: the split's name sharing a row with its
       answer, each person's balance under their column and the trip total
       under Amount, rather than spending a whole row of its own above them.
       Bordered on every side but the bottom: the toolbar above owns the
       rounded top corners (\`.report-toolbar\`), but a border here still
       marks the seam between it and the totals rather than leaving them
       looking fused. The bottom stays open — that seam is to the grid's
       own header directly under it. */
    .totals-band {
      flex: none;
      display: grid;
      align-items: stretch;
      background: var(--surface);
      border: 1px solid var(--border);
      border-bottom: none;
      /* Enough people push the columns wider than the page. AG Grid's own
         body clips and scrolls that internally; this clips the same way —
         see {@link SplitGrid.onBodyScroll} for what keeps it lined up with
         the grid's own columns as it scrolls, rather than left behind. */
      overflow-x: hidden;
    }

    .totals-band .cell {
      display: flex;
      align-items: center;
      padding: 0 6px;
      overflow: hidden;
      border-right: 1px solid var(--border);
    }

    .totals-band .cell:last-child {
      border-right: none;
    }

    /* The merged first three columns — Sheet, the line number, Item — are
       nobody's own figure, which is the room the split's name borrows
       instead of a masthead row of its own. Currency and export used to
       share this cell too; they moved to .report-toolbar, above.
       Top-aligned rather than the cell's own default centering: centered,
       the title would slide up whenever \`.masthead-issue\` appears beneath
       it and back down when it clears — pinning both to the top keeps the
       title still and lets the message claim space below it instead. */
    .totals-band .cell.masthead-cell {
      grid-column: span 3;
      align-items: flex-start;
      padding: 10px 15px;
    }

    .totals-band .cell.grand {
      justify-content: flex-start;
      padding-left: 15px;
      padding-right: 15px;
      font-weight: 700;
      font-size: 15px;
    }

    /* The same quarter turn as the balances used to carry inside the grid —
       see \`.ledger-share\`, below — so the figure here reads in the same
       direction as the person header directly beneath it. */
    .totals-band .cell.person {
      writing-mode: sideways-lr;
      justify-content: flex-start;
      align-items: center;
      padding: 4px;
    }

    /* Takes whatever height \`.report\` has left over above (see \`:host\` and
       \`.report\`), rather than guessing at the surrounding chrome's height
       with \`vh\` math — so the grid's own body is what scrolls, not the
       page. \`min-height: 0\` is load-bearing: a flex item's automatic
       minimum is its content size, which for AG Grid is "every row," and
       without overriding it the grid would refuse to shrink below that and
       force the page to scroll after all. Square at the top — there is no
       gap or border between the totals band's own bottom edge and this
       one, which is the seam — and rounded only at the bottom, where the
       report block actually ends; see the \`.ag-root-wrapper\` override
       below. On phones this reverts to a fixed, \`vh\`-based height instead
       — see the \`@media\` block below. */
    .grid {
      display: block;
      width: 100%;
      flex: 1;
      min-height: 0;
    }

    /* A pinned, page-filling report fights the on-screen keyboard and
       pull-to-refresh on a phone, so this reverts to the page scrolling as
       a whole, with the grid sized off the viewport the way it always was
       — see app.scss's own \`@media\` override for \`:host\` and \`main\`. */
    @media (max-width: 640px) {
      .report {
        display: block;
        height: auto;
        margin-bottom: 16px;
      }

      .grid {
        height: clamp(320px, calc(100vh - 260px), 900px);
      }
    }

    :host ::ng-deep .ag-root-wrapper {
      border-top: none;
      border-top-left-radius: 0;
      border-top-right-radius: 0;
    }

    /* The Settings popup's "Highlight row on hover" toggle. \`rowHoverColor\`
       (grid-theme.ts) compiles to this same custom property on the grid's
       own root, so overriding it here — closer to the row, and with the
       extra specificity Angular's view encapsulation adds to \`:host\` — wins
       over AG Grid's own declaration without having to touch the theme
       object itself, which is a plain object shared by every instance. */
    :host(.no-row-hover) ::ng-deep .ag-root-wrapper {
      --ag-row-hover-color: transparent;
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

    /* The transparent click-catcher behind the context menu — nothing to
       dim, since unlike the editor panel this is not a modal over the grid,
       just a way to notice a click or a right-click elsewhere and close. */
    .context-menu-backdrop {
      position: fixed;
      inset: 0;
      z-index: 55;
    }

    .context-menu {
      position: fixed;
      z-index: 56;
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 170px;
      padding: 6px;
      background: var(--surface);
      border: 1px solid var(--border-strong);
      border-radius: var(--radius-sm);
      box-shadow: 0 8px 24px rgb(20 53 95 / 20%);
    }

    .context-menu .btn {
      width: 100%;
      justify-content: flex-start;
    }

    .context-menu-count {
      padding: 4px 8px 6px;
      margin-bottom: 2px;
      font-size: 12px;
      font-weight: 600;
      color: var(--navy-800);
      border-bottom: 1px solid var(--border);
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
       the merged block of person columns on an add-item row (a share means
       nothing until there is an item to share), and that row's own
       line-number cell (nothing to number until it is one): the button that
       adds a person lives in its header, not down here, a share is typed on
       the item row it belongs to, not the row that creates that item, and a
       line number is read off a real item, not the row still waiting for
       one — so every one of these is exactly as untypeable as a filler
       row's cells.
       The hatch has to sit on each \`.ag-cell\`, not the row: a cell paints its
       own opaque background over whatever the row underneath it has. */
    :host ::ng-deep .ledger-filler-row {
      --ag-cell-horizontal-border: none;
    }

    :host ::ng-deep .ledger-filler-row .ag-cell,
    :host ::ng-deep .ledger-add-person-cell,
    :host ::ng-deep .ledger-add-row-people,
    :host ::ng-deep .ledger-add-row-index {
      background-color: var(--surface);
      background-image: repeating-linear-gradient(
        45deg,
        transparent,
        transparent 4px,
        color-mix(in srgb, var(--text-muted) 14%, transparent) 4px,
        color-mix(in srgb, var(--text-muted) 14%, transparent) 5px
      );
    }

    /* \`onCellFocused\` (split-grid.ts) only runs once AG Grid has already
       drawn its own focus ring for the click that triggered it — a full
       frame the border is visible before the bounce clears it, which reads
       as a flicker. None of these cells can hold anything, so the ring
       should never draw here at all; painting it and then erasing it a
       frame later is the wrong order. \`!important\` because AG Grid's own
       rule matches on the same classes this one does — same specificity,
       so without it the winner would come down to which stylesheet happens
       to load second. */
    :host ::ng-deep .ledger-filler-row .ag-cell.ag-cell-focus,
    :host ::ng-deep .ledger-add-person-cell.ag-cell-focus,
    :host ::ng-deep .ledger-add-row-people.ag-cell-focus,
    :host ::ng-deep .ledger-add-row-index.ag-cell-focus {
      border-color: transparent !important;
      outline: none !important;
    }

    /* The index column is 30 pixels wide, and AG Grid's own padding either
       side leaves the hatch short of the column's real edges. */
    :host ::ng-deep .ledger-add-row-index {
      padding: 0;
    }

    /* All of them but the sheet's own heading: a sheet with no lines yet is a
       block of one row, so its name, charges and panel button sit *on* the add
       row — and they are the sheet, not scaffolding for it. */
    :host ::ng-deep .ledger-add-row .ag-cell:not(.ledger-sheet-cell) {
      color: var(--text-muted);
      font-style: italic;
    }

    /* The add-item row's own cell while it is collapsed: shorter than every
       other row (LEDGER_ADD_ROW_HEIGHT, getRowHeight), so the italic
       placeholder needs a smaller line to still fit centred inside it. Cleared
       once editing starts — see onCellEditingStarted/onCellEditingStopped —
       where it goes back to reading like every other Item cell.
       .ag-cell centres a normal row's text through a line-height AG Grid
       derives from the grid's own rowHeight, not this row's own shorter
       one — getRowHeight overrides are per-row, that derived line-height
       is not, so left alone the text sits by the top of the box rather than
       in the middle of it. Flex centring here does not depend on that
       line-height being right for this row's own actual height. */
    :host ::ng-deep .ag-cell.ledger-add-row-collapsed {
      display: flex;
      align-items: center;
      font-size: 12px;
      line-height: normal;
    }

    /* A cell paints its own opaque background over the row's (see the
       filler-row comment above), so without a rule of its own a paid cell
       would be exactly the same colour on a plain row and a striped one —
       the one place the alternating banding stops. The odd-row variant is
       the same tint mixed a little darker, so the banding keeps reading
       through underneath it instead of flattening out. */
    :host ::ng-deep .ledger-paid {
      background: var(--paid-bg);
    }

    :host ::ng-deep .ag-row-odd .ledger-paid {
      background: color-mix(in srgb, var(--paid-bg) 100%, var(--text) 6%);
    }

    /* A priced row nobody has claimed a share of — the workbook's red cells. */
    :host ::ng-deep .ledger-missing {
      background: var(--credit-bg);
    }

    :host ::ng-deep .ag-row-odd .ledger-missing {
      background: color-mix(in srgb, var(--credit-bg) 100%, var(--text) 6%);
    }

    /* Scaffolding for the eye, not data: it should sit behind everything. */
    :host ::ng-deep .ledger-index {
      justify-content: center;
      align-items: center;
      align-content: center;
      color: var(--text-muted);
      font-variant-numeric: tabular-nums;
      font-size: 12px;
      /* The column is 45 pixels wide, and AG Grid's default 15 either side
         would leave a centered number nowhere to breathe — dropped so the
         number can sit centered in the cell it actually has. */
      --ag-cell-horizontal-padding: 0px;
      /* The value is a bare text node, not a flex child, so justify-content
         above has nothing to act on — this is what actually centers it. */
      text-align: center;
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
      /* The value is a bare text node, not a flex child, so justify-content
         above has nothing to act on — this is what actually centers it. */
      text-align: center;
    }

    /* A person column is 40 pixels wide, and AG Grid's 15 either side leaves
       a share reading "9.9" nowhere to go but off the edge. Dropped only
       while the cell is showing its value, not while it holds the editor —
       that still wants room around the input. */
    :host ::ng-deep .ledger-share:not(.ag-cell-inline-editing) {
      --ag-cell-horizontal-padding: 0px;
    }

    :host ::ng-deep .ledger-share.ag-cell-inline-editing input {
      text-align: center;
    }

    /* Reused by the totals band above the grid — see \`.totals-band .person\`
       in \`split-grid.html\` — for the same red the workbook used for someone
       who is owed rather than owing. */
    :host ::ng-deep .ledger-credit {
      color: var(--credit);
    }

    /* The selected block. An inset ring rather than a fill, so the paid and
       unassigned colours underneath still read through it. */
    :host ::ng-deep .ledger-selected {
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

    /* AG Grid's own scrollbar element, not the browser's native one on the
       grid body itself (that one is hidden entirely) — see \`scrollbarWidth\`
       on the grid for the width this has to match, since that number also
       sets how much layout space the grid reserves for it. The up/down
       buttons Windows Chrome draws on a classic scrollbar have no matching
       AG Grid option, so they come off here instead.
       \`scrollbar-color\`/\`scrollbar-width\` are set alongside the
       \`::-webkit-scrollbar-*\` pseudo-elements, not instead of them: without
       an explicit thumb colour the browser falls back to its own default,
       which can render indistinguishable from the track depending on the
       OS/browser theme — the standard properties are Chromium's newer,
       better-supported path for the same thing. */
    :host ::ng-deep .ag-body-vertical-scroll-viewport {
      scrollbar-width: thin;
      scrollbar-color: var(--border-strong) transparent;
    }
    :host ::ng-deep .ag-body-vertical-scroll-viewport::-webkit-scrollbar {
      width: ${GRID_SCROLLBAR_WIDTH}px;
    }
    :host ::ng-deep .ag-body-vertical-scroll-viewport::-webkit-scrollbar-button {
      display: none;
      width: 0;
      height: 0;
    }
    :host ::ng-deep .ag-body-vertical-scroll-viewport::-webkit-scrollbar-track {
      background: transparent;
    }
    :host ::ng-deep .ag-body-vertical-scroll-viewport::-webkit-scrollbar-thumb {
      background: var(--border-strong);
      border-radius: 4px;
    }

    /* The horizontal counterpart to the block above — same reasoning, but a
       scrollbar's thickness is its \`height\` on this axis, not its \`width\`. */
    :host ::ng-deep .ag-body-horizontal-scroll-viewport {
      scrollbar-width: thin;
      scrollbar-color: var(--border-strong) transparent;
    }
    :host ::ng-deep .ag-body-horizontal-scroll-viewport::-webkit-scrollbar {
      height: ${GRID_SCROLLBAR_WIDTH}px;
    }
    :host ::ng-deep .ag-body-horizontal-scroll-viewport::-webkit-scrollbar-button {
      display: none;
      width: 0;
      height: 0;
    }
    :host ::ng-deep .ag-body-horizontal-scroll-viewport::-webkit-scrollbar-track {
      background: transparent;
    }
    :host ::ng-deep .ag-body-horizontal-scroll-viewport::-webkit-scrollbar-thumb {
      background: var(--border-strong);
      border-radius: 4px;
    }
    /* This one measures the real native scrollbar thickness before
       \`scrollbarWidth\` reaches it (its own \`eViewport\` sets an inline
       height from that measurement, ahead of the vertical scrollbar's
       equivalent read), so it ends up reserving more than the vertical bar
       actually gets. \`!important\` beats that inline style. */
    :host ::ng-deep .ag-body-horizontal-scroll-viewport {
      height: ${GRID_SCROLLBAR_WIDTH}px !important;
    }

    /* AG Grid positions this wrapper with \`top: 0\` but never sets \`bottom\`,
       so with nothing else constraining its height it grows to fit its
       child — a spacer element AG Grid stretches to the grid's *full*
       (unscrolled) content height — instead of staying pinned to the
       visible frame. Invisible while \`alwaysShowVerticalScroll\` had no
       overflowing data to show it, but once a sheet grows past one
       screen the bar balloons well past the grid's own bottom edge. */
    :host ::ng-deep .ag-body-vertical-scroll {
      bottom: 0;
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
      text-align: center;
    }

    /* The Sheet cell is a spine of sideways boxes rather than a line of text:
       it takes the whole cell, and the cell's own side padding — which would be
       half of a column this narrow — has to go. */
    :host ::ng-deep .ledger-sheet-cell {
      align-items: stretch;
      padding: 0;
      line-height: 1.35;
      border-top-width: 0;
      border-left-width: 0;
      border-bottom-width: 0;
    }

    /* AG Grid sets its own one-pixel border on every side the instant a
       click lands on this cell — including a click that only meant to
       focus the name/charge box inside it — regardless of the rule above,
       which only zeroed those three sides' width for the ordinary,
       unfocused case and never touched what happens on focus. The colour
       was transparent either way, but the width genuinely changing (0 to
       1px and back) shrinks the content box and shifts everything inside
       it by a pixel — a real reflow, not just a colour flash, which is
       what actually reads as a flicker. Repeating the same zero here, this
       time for the focused case specifically, is the fix. !important
       because AG Grid's own rule matches the same class at the same
       specificity, so without it the winner is whichever stylesheet
       happens to load second. */
    :host ::ng-deep .ledger-sheet-cell.ag-cell-focus {
      border-top-width: 0 !important;
      border-left-width: 0 !important;
      border-bottom-width: 0 !important;
      border-color: transparent !important;
      outline: none !important;
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
       is 40 pixels wide, and AG Grid's 16 either side would leave the header
       component 8 to work with instead of the 40 it is sized for. */
    :host ::ng-deep .ledger-person-header {
      --ag-cell-horizontal-padding: 0px;
    }

    /* The same fix, for the same reason: the line-number header's "#" button
       is meant to fill its 30-pixel column, not sit inside AG Grid's 16
       either side. */
    :host ::ng-deep .ledger-index-header {
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
       wrapper AG Grid already draws the header inside; that wrapper's sibling
       on the scrolling side is \`.ag-grid-scrolling-rows\`, and it is those
       two that are actually compared once a descendant on either side asks
       for a stacking context.
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

    /* AG Grid only paints the header's navy background on
       .ag-grid-scrolling-cells, sized to the real column content — it stops
       short of the header's own full width by GRID_SCROLLBAR_WIDTH, the
       gutter reserved for the always-on vertical scrollbar (see "Always
       reserve the grid's vertical scrollbar space"). Left unpainted, that
       gutter shows .ag-grid-pinned-top-rows's own white background through
       as a sliver right of the add-person column. Backstopped here so the
       header reads as one solid bar edge to edge no matter what AG Grid's
       own content wrapper covers. */
    :host ::ng-deep .ag-header {
      background: var(--navy-800);
    }
  `,
})
export class SplitGrid {
  protected readonly store = inject(TripStore);
  protected readonly settings = inject(ReportSettings);
  protected readonly defaultTotalsBandHeight = DEFAULT_TOTALS_BAND_HEIGHT;
  private readonly elementRef = inject(ElementRef<HTMLElement>);
  private readonly destroyRef = inject(DestroyRef);

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
    this.resolvePendingAddRowFocus();

    const shape = this.blockShape();
    if (shape === this.lastRefreshedShape) {
      return;
    }
    this.lastRefreshedShape = shape;
    this.api?.refreshCells({ columns: ['sheet'], force: true });

    // A row-count change — exactly what `shape` tracks — is exactly when the
    // vertical scrollbar can appear or disappear, which is what moves Item's
    // real width; see `itemColumnWidth`'s doc comment for why that needs a
    // fresh read here rather than only reacting to the viewport resizing.
    this.refreshItemColumnWidth();
  }

  /**
   * Focuses (and, for Enter, starts editing) wherever {@link commitAddItemRow}
   * decided a Tab or Enter commit on the add-item row should land — deferred
   * until here because the row it targets does not exist in the grid's model
   * until the `rows()` this commit triggered has made its way back through
   * `[rowData]`. Ungated, unlike the repaint below it: this has to run on
   * every `modelUpdated`, not just the ones that change a block's shape,
   * since it is a one-shot request cleared the moment it is read.
   */
  private resolvePendingAddRowFocus(): void {
    const pending = this.pendingAddRowFocus;
    if (!pending) {
      return;
    }
    this.pendingAddRowFocus = null;
    const api = this.api;
    const rowIndex = api?.getRowNode(pending.rowId)?.rowIndex;
    if (api == null || rowIndex == null) {
      return;
    }
    api.setFocusedCell(rowIndex, pending.col);
    if (pending.startEdit) {
      api.startEditingCell({ rowIndex, colKey: pending.col });
    }
  }

  private lastRefreshedShape: string | null = null;

  /** How many lines each sheet has, as one string — see {@link onModelUpdated}. */
  private readonly blockShape = computed(() =>
    this.store.sheets().map((sheet) => sheet.items.length).join(','),
  );

  protected readonly theme = ledgerTheme;
  protected readonly scrollbarWidth = GRID_SCROLLBAR_WIDTH;

  /** Shared with the Sheet cell, which has to size a spanned block itself. */
  protected readonly rowHeight = LEDGER_ROW_HEIGHT;

  /**
   * Every row is one line tall except: the filler row that closes a short
   * block, which is as many as {@link LedgerFillerRow.rows} says — the padding
   * a block needs collapsed into one row rather than spread across several
   * identical ones; and the add-item row, which is short until it is actually
   * being typed into (see {@link editingAddRowId}). AG Grid calls this per row
   * in place of the flat `rowHeight` once it is supplied.
   */
  protected readonly getRowHeight = (params: RowHeightParams<LedgerRowData>): number => {
    if (params.data?.kind === 'filler') {
      return params.data.rows * LEDGER_ROW_HEIGHT;
    }
    if (params.data?.kind === 'add-item') {
      return ledgerRowId(params.data) === this.editingAddRowId() ? LEDGER_ROW_HEIGHT : LEDGER_ADD_ROW_HEIGHT;
    }
    return LEDGER_ROW_HEIGHT;
  };

  /**
   * The add-item row currently mid-edit, by its {@link ledgerRowId} — set
   * from {@link onCellEditingStarted}/{@link onCellEditingStopped}. At most
   * one at a time: only one cell can edit. Every other sheet's add-item row
   * stays collapsed to {@link LEDGER_ADD_ROW_HEIGHT}.
   *
   * Tied to *editing*, not focus: a plain click only selects the row's one
   * merged field (see the `item` column's `colSpan` in {@link columns},
   * which — unlike the height here — never varies; an add-item row is
   * always one merged cell, focused or not, because it is never anything
   * but a name to type until Tab or Enter turns it into a real item row).
   * Growing the row on a bare click, before there was anything to type,
   * read as the row reacting to being merely looked at.
   */
  protected readonly editingAddRowId = signal<string | null>(null);

  /**
   * Where to move focus once the row data AG Grid is showing has caught up
   * with a commit made from {@link commitAddItemRow} — read and cleared in
   * {@link onModelUpdated}, which is the grid's own signal that a new
   * `rowData` has actually landed, rather than a guessed delay (see that
   * method's own doc comment for why a `setTimeout` is the wrong tool here).
   */
  private pendingAddRowFocus: { rowId: string; col: 'item' | 'amount'; startEdit: boolean } | null = null;

  /**
   * Set by {@link setItemField}'s add-item branch, immediately after
   * `store.addItem` — the only way {@link commitAddItemRow} can tell, right
   * after calling `api.stopEditing()`, whether typing Tab/Enter actually
   * created an item (a blank name is rejected and creates nothing).
   */
  private lastCreatedItemId: string | null = null;

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
     * line yet, and there is nothing to do to it here.
     *
     * It belongs *inside* this object: given `rowSelection` as options rather
     * than a bare mode string, AG Grid reads `isRowSelectable` from here and
     * ignores the grid option of the same name, silently.
     */
    isRowSelectable: (node) => node.data?.kind === 'item',
  };

  /** The sheet whose settings panel is open, or null. */
  protected readonly editingSheetId = signal<string | null>(null);

  /** Whether the report's own settings popup — see `settings-popup.ts` — is open. */
  protected readonly settingsOpen = signal(false);

  /** Whether the sheet-reorder dialog — see `sheet-reorder-dialog.ts` — is open. */
  protected readonly reorderOpen = signal(false);

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

  /**
   * The totals band above the grid is a hand-built row, not one AG Grid
   * scrolls for it — so when there are enough people to push the columns
   * wider than the page, this is what keeps it lined up under the same
   * headers rather than left behind (or, without any containment of its
   * own, forcing the whole page to scroll sideways around it: AG Grid's
   * own body clips and scrolls internally, but a plain block element just
   * overflows its box). `overflow-x: hidden` on `.totals-band` clips it the
   * same way; setting `scrollLeft` still moves the clipped content even
   * though the scrollbar itself is hidden.
   */
  private readonly totalsBand = viewChild<ElementRef<HTMLElement>>('totalsBand');

  /**
   * The Item column's real, resolved pixel width, read straight from AG
   * Grid — see {@link totalsColumns}, which uses this instead of its own
   * `minmax(150px, 1fr)` guess.
   *
   * Item is the ledger's one flexible column; everything else is a fixed
   * pixel width both here and in {@link columns}, so it is the only place
   * two independent layout engines computing "the same" `1fr` share can
   * still disagree. They do: told to reserve room for the vertical
   * scrollbar, AG Grid narrows its *columns'* combined width without
   * narrowing `.ag-grid-viewport`'s own `clientWidth` — confirmed against a
   * real (non-overlay) Windows scrollbar, where the viewport, the wrapper
   * and the band all agreed on one outer width while the grid's Item column
   * still came out 13px narrower than the band's own `1fr` guess, shifting
   * Amount and every person column after it that far right of the grid's
   * real ones. Copying AG Grid's own number here, rather than re-deriving
   * one from a box width that turned out not to carry the scrollbar's
   * effect, is what keeps the two in step regardless of how any given
   * browser reserves that space.
   */
  protected readonly itemColumnWidth = signal<number | null>(null);

  /** Re-reads {@link itemColumnWidth} from the grid — see its own doc comment
   *  for why a fresh read, not a cached one, is what a scrollbar coming or
   *  going needs. */
  private refreshItemColumnWidth(): void {
    const width = this.api?.getColumn('item')?.getActualWidth();
    if (width != null) {
      this.itemColumnWidth.set(width);
    }
  }

  /**
   * The band's own resync for a viewport resize — a window resize or a
   * browser zoom, both of which resize `.ag-grid-viewport` and leave AG
   * Grid to re-resolve Item's flex width against the new box.
   *
   * Bound to `columnResized` rather than a `ResizeObserver` on the viewport:
   * a `ResizeObserver` fires the instant the box changes, before AG Grid's
   * *own* resize handling — queued behind a `requestAnimationFrame` inside
   * `centerContainerCtrl`'s listener — has actually recomputed Item's width,
   * so reading `getActualWidth()` from one raced AG Grid's own recalculation
   * and could as easily read the width the box had a moment ago. A
   * `columnResized` event with `flexColumns` set is dispatched from inside
   * that same recomputation, once it is done — the grid's own signal that a
   * fresh read will actually be fresh, the same reasoning `onModelUpdated`'s
   * own doc comment gives for why a guessed delay is the wrong tool here.
   */
  protected onColumnResized(event: ColumnResizedEvent<LedgerRowData>): void {
    if (event.flexColumns?.length) {
      this.refreshItemColumnWidth();
    }
  }

  constructor() {
    // A person added or removed changes how many fixed-width columns Item's
    // flex share is competing with — {@link onModelUpdated} does not see
    // this, since the row *model* has not changed, only the columns. Run
    // after the `[columnDefs]` binding below has actually reached AG Grid
    // and it has re-resolved Item's width against the new column set, not
    // in the same tick this fires — a `setTimeout` alongside the other one
    // in {@link onGridReady}, not a coincidence.
    effect(() => {
      this.store.people().length;
      setTimeout(() => this.refreshItemColumnWidth());
    });
  }

  /**
   * Kept as a second path, not the only one — see the native listener wired
   * up in {@link onGridReady}. AG Grid's own `bodyScroll` output goes through
   * its internal event bus, and does not fire for every way the grid's
   * viewport can scroll (observed: `api.ensureColumnVisible()` moves the real
   * `scrollLeft` without it, the same gap `ag-grid-outputs-are-async`-style
   * bugs elsewhere in this file come from) — so a real scroll could move the
   * grid without ever reaching this handler, leaving the band behind until
   * some other scroll happened to fire the output correctly.
   */
  protected onBodyScroll(event: BodyScrollEvent): void {
    const el = this.totalsBand()?.nativeElement;
    if (el) {
      el.scrollLeft = event.left;
    }
  }

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

      // The primary sync for the totals band's horizontal scroll — bound
      // straight to the element the grid actually scrolls, bypassing AG
      // Grid's own `bodyScroll` output entirely (see the doc comment on
      // {@link onBodyScroll} for why that output alone is not enough).
      const viewport = this.elementRef.nativeElement.querySelector(
        '.ag-grid-viewport',
      ) as HTMLElement | null;
      if (viewport) {
        const syncBand = () => {
          const band = this.totalsBand()?.nativeElement;
          if (band) {
            band.scrollLeft = viewport.scrollLeft;
          }
        };
        viewport.addEventListener('scroll', syncBand, { passive: true });
        this.destroyRef.onDestroy(() => viewport.removeEventListener('scroll', syncBand));
      }

      this.refreshItemColumnWidth();
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

  protected onTitle(event: Event): void {
    this.store.setTitle((event.target as HTMLInputElement).value);
  }

  /** Downloads the active split as a JSON file. */
  protected exportActive(): void {
    const active = this.store.splitById(this.store.activeSplitId());
    if (active) {
      downloadJson(exportFileName([active]), buildExportPayload([active]));
    }
  }

  /** Adds a sheet with its default name and charges — no popup. */
  protected addSheet(): void {
    this.store.addSheet();
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
    // A right (or middle) click is not a selection gesture: left unguarded, a
    // browser fires `mousedown` for every button, and this handler would
    // otherwise toggle a line's tick off — or start a cell-range drag —
    // right before the `contextmenu` event it is about to open a menu from,
    // so the tick a right-click was aimed at is gone by the time
    // {@link onCellContextMenu} goes looking for it.
    if ((event.event as MouseEvent | null)?.button !== 0) {
      return;
    }
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

  /**
   * Bounces focus off cells that hold nothing to read or type: the filler
   * beneath a short block, the add-person column, and — on an add-item row —
   * both the line-number cell and the merged block of person columns beside
   * it, all hatched the same way for the same reason, see {@link columns}'s
   * `add-person` entry.
   *
   * `suppressNavigable` (on {@link defaultColDef} for the filler rows, on
   * the `add-person` column itself for every row, on the index and person
   * columns for an add-item row) already keeps Tab and the arrow keys from
   * stopping on any of them. A mouse click is the one way in none of them
   * covers, since AG Grid focuses the cell as part of its own mousedown
   * handling, before `(cellMouseDown)` — an output, not a hook — gets a
   * chance to react. Clearing it back out here is a click late, but a click
   * late is as early as there is.
   */
  protected onCellFocused(event: CellFocusedEvent<LedgerRowData>): void {
    if (event.rowIndex == null) {
      return;
    }
    const colId = typeof event.column === 'string' ? event.column : event.column?.getColId();
    if (colId === 'add-person') {
      this.api?.clearFocusedCell();
      return;
    }
    const node = this.api?.getDisplayedRowAtIndex(event.rowIndex);
    if (node?.data?.kind === 'filler') {
      this.api?.clearFocusedCell();
      return;
    }
    if (node?.data?.kind === 'add-item' && (colId === 'index' || colId?.startsWith('person:'))) {
      this.api?.clearFocusedCell();
    }
  }

  /**
   * Grows the add-item row to full height the moment it's actually being
   * typed into — see {@link editingAddRowId}'s own doc comment for why this
   * is tied to editing rather than to focus.
   */
  protected onCellEditingStarted(event: CellEditingStartedEvent<LedgerRowData>): void {
    if (event.data?.kind !== 'add-item') {
      return;
    }
    this.editingAddRowId.set(ledgerRowId(event.data));
    // Re-runs `getRowHeight` for every row (cheap at this grid's size).
    this.api?.resetRowHeights();
  }

  /**
   * Collapses the add-item row back down once editing ends, however it
   * ended — a commit, a blank value `setItemField` rejected, or Escape. If
   * the name committed, the row this id names is a real item row by now
   * (see `commitAddItemRow`), so there is nothing left to collapse; setting
   * `editingAddRowId` to `null` and resizing is harmless either way, since
   * `getRowHeight` only ever reads it for a row that is still `add-item`.
   */
  protected onCellEditingStopped(event: CellEditingStoppedEvent<LedgerRowData>): void {
    if (event.data?.kind !== 'add-item') {
      return;
    }
    this.editingAddRowId.set(null);
    this.api?.resetRowHeights();
    // The collapsed-look `cellClassRules` on the item and amount columns
    // only re-check themselves when a cell is told to — unlike the row
    // height above, which `resetRowHeights` re-asks for on its own. Only
    // needed here, not from `onCellEditingStarted`: while actually editing,
    // the live text-editor covers the resting cell entirely, so its class
    // being stale for that one moment is invisible.
    this.api?.refreshCells({ columns: ['item', 'amount'], force: true });
  }

  /**
   * Tab and Enter get their own behaviour on the add-item row's Item and
   * Amount cells — a new line can start from either field — suppressing AG
   * Grid's own default handling for the two — see both columns' own
   * `suppressKeyboardEvent` in {@link columns}, which is what calls this.
   * Left to AG Grid's own default Tab/Enter, this can't be reliably
   * overridden from the `(cellKeyDown)` *output*: that fires as a
   * notification of a keydown AG Grid's own internal listener has, by then,
   * already acted on — `preventDefault()` from there is too late to stop it.
   * `suppressKeyboardEvent` runs *before* AG Grid decides what to do with the
   * key, which is the one hook actually meant for replacing that decision.
   *
   * Custom handling is needed at all because committing a value here turns
   * this row into a real item row and moves the add-item id onto a fresh
   * blank row below it (`ledger-model.ts`'s `buildLedgerRows`) — a
   * destroy-and-recreate under `getRowId`, not an in-place update, and
   * default Tab/Enter target resolution is not guaranteed to survive that.
   *
   *   - Tab commits and focuses the new item's *other* field — Amount if the
   *     name was what got typed, Item if the amount was — since the row is
   *     a real, unmerged item row by then and whichever field started it is
   *     the one already filled in.
   *   - Enter commits and focuses (and starts editing) the sheet's new,
   *     now-blank add-item row's *same* field that was just typed into —
   *     Item after Item, Amount after Amount — so a run of Enter presses
   *     adds several items by whichever field without touching the mouse.
   *
   * A blank commit (nothing typed) creates nothing — {@link setItemField}
   * rejects it — so there is nothing new to focus, on either key: the row
   * is still add-item, and this just leaves editing, the way it would
   * anywhere else in this grid with nothing to react to.
   */
  private commitAddItemRow(
    key: 'Tab' | 'Enter',
    sheetId: string,
    rowIndex: number | null,
    sourceCol: 'item' | 'amount',
  ): void {
    const api = this.api;
    if (!api || rowIndex == null) {
      return;
    }

    this.lastCreatedItemId = null;
    api.stopEditing();
    const itemId = this.lastCreatedItemId;

    if (key === 'Tab') {
      if (itemId) {
        const col = sourceCol === 'item' ? 'amount' : 'item';
        this.pendingAddRowFocus = { rowId: `item:${itemId}`, col, startEdit: false };
      }
      return;
    }

    if (itemId) {
      this.pendingAddRowFocus = { rowId: `add-item:${sheetId}`, col: sourceCol, startEdit: true };
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

    this.store.transaction(() => {
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
          // Written even when blank: a fill repeats the base block exactly, and
          // an empty source cell is part of that pattern, not a gap in it — the
          // same reason dragging a blank cell over a filled one clears it in
          // every spreadsheet this is standing in for.
          node.setDataValue(columns[col], source[srcRow][srcCol] ?? '');
        }
      }
    });
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

  /**
   * Where the context menu is open, in viewport coordinates — AG Grid's own
   * menu is Enterprise, so a right-click is handled directly instead of
   * through `getContextMenuItems`.
   */
  protected readonly contextMenuPos = signal<{ x: number; y: number } | null>(null);

  /**
   * Opens the menu at the pointer, on whichever lines are ticked — bound on
   * the host as a plain `(contextmenu)` listener, deliberately *not* through
   * AG Grid's own `(cellContextMenu)` output.
   *
   * `Event.preventDefault()` only suppresses the browser's own context menu
   * when it runs synchronously, before the native `contextmenu` event
   * finishes dispatching. AG Grid's Output fires *after* that — proven by a
   * real-DOM test in `split-grid.spec.ts` that reads `defaultPrevented`
   * synchronously rather than after an `await`, which is what let the first
   * attempt at this look like it worked when it did not. A plain host
   * listener is an ordinary `addEventListener`, called in time.
   *
   * Ticking is the line number's job alone (see {@link onCellMouseDown}) — a
   * right-click never changes it, wherever it lands. The menu acts on the
   * tick as a whole, not on the row under the pointer, so a right-click
   * opens it as long as *something* is ticked, anywhere within the grid's
   * own rows — including the blank "add" row, which has nothing of its own
   * but sits right next to lines that might. Outside the grid — the legend,
   * the sheet editor's own text boxes — or with nothing ticked at all, there
   * is nothing to act on, and the browser's own menu is left alone.
   *
   * Checked against `api.getSelectedNodes()` rather than {@link ticked} —
   * {@link onSelectionChanged} is itself one of AG Grid's own outputs, and
   * lags a right-click that follows hard on the left-click that did the
   * ticking by the same margin `cellContextMenu` did above. The API's own
   * selection state has no such lag: `setSelected` applies it immediately,
   * synchronously, which is the only kind of "immediately" this handler can
   * trust.
   */
  protected onContextMenu(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (!target?.closest('.ag-row') || !this.api?.getSelectedNodes().length) {
      return;
    }
    event.preventDefault();
    this.contextMenuPos.set({ x: event.clientX, y: event.clientY });
  }

  protected closeContextMenu(): void {
    this.contextMenuPos.set(null);
  }

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
    this.store.transaction(() => {
      for (const line of this.tickedItems()) {
        this.store.removeItem(line.sheetId, line.itemId);
      }
    });
    this.api?.deselectAll();
  }

  protected splitTickedEvenly(): void {
    this.store.transaction(() => {
      for (const line of this.tickedItems()) {
        this.store.splitItemEvenly(line.itemId);
      }
    });
  }

  protected clearTickedShares(): void {
    this.store.transaction(() => {
      for (const line of this.tickedItems()) {
        this.store.clearItemShares(line.itemId);
      }
    });
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
   * The filler beneath a short block is padding, not a line — nothing to
   * copy from, paste into, or drag a block across, so a click there can
   * start or extend nothing. The merged, hatched block of person columns on
   * an add-item row is the same story: a share means nothing until there is
   * an item to share, so it is excluded here the same way, not just
   * repainted differently — {@link onCellMouseDown} falls back to clearing
   * the selection outright for a `null` ref, which is the point: a click on
   * either should behave like a click on nothing, not like a click that
   * happens to land on an empty cell.
   */
  private cellRef(node: IRowNode<LedgerRowData>, colId: string): CellRef | null {
    if (node.data?.kind === 'filler') {
      return null;
    }
    if (node.data?.kind === 'add-item' && colId.startsWith('person:')) {
      return null;
    }
    const col = this.selectableColumns().indexOf(colId);
    if (col < 0 || node.rowIndex == null) {
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

    this.store.transaction(() => {
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
    });
  }

  /**
   * Delete and Backspace clear the selected block — Backspace too, since a
   * Mac keyboard has no other key that means "delete" and there is nothing
   * else here for it to do: neither key starts an edit on a focused, resting
   * cell the way a printable one does, so today they land on nothing at all.
   *
   * `isTyping` guards this the same way it guards {@link onCopy} and
   * {@link onPaste}: with a cell actually being edited, Backspace has its
   * ordinary job of erasing a character and must be left alone.
   *
   * Ctrl+Z / Ctrl+Y (and Ctrl+Shift+Z) undo/redo the split's own edit
   * history. Same `isTyping` guard: with a cell or a name box actually being
   * edited, Ctrl+Z is left to do the browser's ordinary single-field undo
   * instead of being intercepted here.
   */
  protected onKeyDown(event: KeyboardEvent): void {
    if (isUndoKey(event) || isRedoKey(event)) {
      if (isTyping(event.target)) {
        return;
      }
      event.preventDefault();
      if (isUndoKey(event)) {
        this.store.undo();
      } else {
        this.store.redo();
      }
      return;
    }

    if (event.key !== 'Delete' && event.key !== 'Backspace') {
      return;
    }
    const api = this.api;
    const range = this.selection();
    if (!api || !range || isTyping(event.target)) {
      return;
    }
    event.preventDefault();
    const columns = this.selectableColumns();
    const { top, left, bottom, right } = rangeBounds(range);
    this.store.transaction(() => {
      for (let row = top; row <= bottom; row++) {
        const node = api.getDisplayedRowAtIndex(row);
        if (node?.data?.kind !== 'item') {
          continue;
        }
        for (let col = left; col <= right; col++) {
          node.setDataValue(columns[col], '');
        }
      }
    });
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
    // The filler beneath a short block is padding, not a line: Tab and the
    // arrow keys should step over it rather than stop on it. A mouse click
    // still focuses it — AG Grid decides that before any handler here gets a
    // say — so {@link SplitGrid.onCellFocused} bounces that case back off.
    suppressNavigable: ((p) =>
      p.data?.kind === 'filler') satisfies SuppressNavigableCallback<LedgerRowData>,
  };

  protected readonly rows = computed<LedgerRowData[]>(() =>
    buildLedgerRows(this.store.split().rows, this.store.sheets()),
  );

  /**
   * The totals band is plain HTML, not a grid row, so its columns have to be
   * told to match the real ones by hand rather than inheriting them. Every
   * width here is copied from {@link columns} — Sheet's 70, the line number's
   * 30, Amount's 100, 40 for every person, and {@link ADD_PERSON_COLUMN_WIDTH}
   * for the trailing add-person column, plus one more trailing
   * {@link GRID_SCROLLBAR_WIDTH} spacer with
   * no cell of its own, matching the same padding the grid adds to its own
   * scrollable content — see that constant's doc comment for why the band's
   * horizontal scroll falls short of the grid's without it. Item is the one
   * exception, `flex: 1, minWidth: 150` in the grid and cannot be copied as
   * a literal: it is read live from {@link
   * itemColumnWidth} instead. Nothing else here is user-resizable
   * (`defaultColDef.resizable` is false) and a person's own width never
   * changes when their column is dragged to reorder, so only Item needs
   * watching at runtime — see its own doc comment for why even one flexible
   * column can't be re-derived from a `minmax()` guess of the same width.
   */
  protected readonly totalsColumns = computed(() => {
    // Not `repeat(N, 40px)`: with nobody in the split yet, N is 0, and
    // `repeat()` treats a zero count as invalid — which invalidates the
    // whole `grid-template-columns` declaration, not just that term, and
    // the band collapses to an unstyled implicit grid.
    const peopleTracks = Array(this.store.people().length).fill('40px').join(' ');
    const itemWidth = this.itemColumnWidth();
    const itemTrack = itemWidth != null ? `${itemWidth}px` : 'minmax(150px, 1fr)';
    return [
      '70px',
      '30px',
      itemTrack,
      '100px',
      peopleTracks,
      `${ADD_PERSON_COLUMN_WIDTH}px`,
      `${GRID_SCROLLBAR_WIDTH}px`,
    ]
      .filter(Boolean)
      .join(' ');
  });

  protected readonly columns = computed<ColDef<LedgerRowData>[]>(() => {
    const people = this.store.people();

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
          // So the merged Sheet-name box can size itself off the add-item
          // row's *actual* current height instead of assuming every row in
          // the block is `LEDGER_ROW_HEIGHT` — see `sheet-cell.ts`'s height
          // `effect()`.
          isAddRowEditing: (sheetId: string) => this.editingAddRowId() === `add-item:${sheetId}`,
        },
      },
      {
        colId: 'index',
        headerName: '#',
        headerComponent: IndexHeader,
        headerClass: 'ledger-index-header',
        width: 30,
        // AG Grid's own default minWidth is `min(36, rowHeight)`, wider than
        // this column is meant to be, and left alone it wins over `width`
        // above — see `ADD_PERSON_COLUMN_WIDTH`'s colDef for the same fix.
        minWidth: 30,
        editable: false,
        // Derived, so it is not part of a copy: pasting a line number over
        // another line would mean nothing.
        cellClass: (p) =>
          p.data?.kind === 'item'
            ? 'ledger-index ledger-index-tickable'
            : p.data?.kind === 'add-item'
              ? 'ledger-add-row-index'
              : 'ledger-index',
        cellClassRules: {
          'ledger-index-ticked': (p) => p.node.isSelected() ?? false,
        },
        // There is no line to number yet, so — like the merged person block
        // beside it — this is hatched rather than left reading as a tickable
        // line. `onCellFocused` bounces the click a colDef can't stop; the
        // `filler` half here just repeats {@link defaultColDef}'s own rule,
        // which a colDef's own `suppressNavigable` replaces rather than adds
        // to.
        suppressNavigable: ((p) =>
          p.data?.kind === 'add-item' ||
          p.data?.kind === 'filler') satisfies SuppressNavigableCallback<LedgerRowData>,
        valueGetter: (p: ValueGetterParams<LedgerRowData>) =>
          p.data?.kind === 'item' ? p.data.index : '',
      },
      {
        colId: 'item',
        headerName: 'Item',
        flex: 1,
        minWidth: 150,
        editable: (p) => p.data?.kind === 'item' || p.data?.kind === 'add-item',
        // Tab and Enter get their own behaviour on this row — see
        // {@link commitAddItemRow} for why AG Grid's own default handling has
        // to be suppressed here rather than reacted to afterwards. Amount's
        // own `suppressKeyboardEvent` calls the same method, since a new
        // item can start from either field.
        suppressKeyboardEvent: (p: SuppressKeyboardEventParams<LedgerRowData>) => {
          if (p.data?.kind !== 'add-item' || (p.event.key !== 'Tab' && p.event.key !== 'Enter')) {
            return false;
          }
          p.event.preventDefault();
          this.commitAddItemRow(p.event.key, p.data.sheetId, p.node.rowIndex, 'item');
          return true;
        },
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
          // Re-derived by the `refreshCells` call in
          // {@link onCellEditingStarted}/{@link onCellEditingStopped} — the
          // row's own collapsed height comes from `getRowHeight`, this is
          // what shrinks the cell's own padding/line-height to fit it.
          'ledger-add-row-collapsed': (p) =>
            p.data?.kind === 'add-item' && ledgerRowId(p.data) !== this.editingAddRowId(),
        },
      },
      {
        colId: 'amount',
        headerName: 'Amount',
        width: 100,
        type: 'numericColumn',
        // \`numericColumn\` right-aligns its header text along with the cell
        // values; the values should stay that way (a column of money reads
        // by its ones place), but the title reads better centered over a
        // column this narrow. An explicit \`headerClass\` replaces the type's
        // own rather than adding to it, so the cell values keep their own
        // right alignment only because \`ledger-numeric\`/\`ledger-total\`,
        // below, set it independently.
        headerClass: 'ledger-amount-header',
        editable: (p) => p.data?.kind === 'item' || p.data?.kind === 'add-item',
        // The other half of the Item column's own `suppressKeyboardEvent` —
        // see {@link commitAddItemRow}. A new item can start from either
        // field, so committing an amount here goes through the same
        // destroy-and-recreate-aware Tab/Enter handling Item needs.
        suppressKeyboardEvent: (p: SuppressKeyboardEventParams<LedgerRowData>) => {
          if (p.data?.kind !== 'add-item' || (p.event.key !== 'Tab' && p.event.key !== 'Enter')) {
            return false;
          }
          p.event.preventDefault();
          this.commitAddItemRow(p.event.key, p.data.sheetId, p.node.rowIndex, 'amount');
          return true;
        },
        valueGetter: (p: ValueGetterParams<LedgerRowData>) =>
          p.data?.kind === 'item' ? p.data.row.item.amount : null,
        // Money on the way out, a plain number on the way in. A formatter only
        // ever draws the *resting* cell — AG Grid hands the editor the raw
        // value — so the symbol and separators are there to read and gone the
        // moment you type over them.
        //
        // In the sheet's own currency, not the trip's: this column carries
        // whatever each block was billed in.
        valueFormatter: (p) =>
          p.data?.kind === 'item' ? money.transform(p.value, this.symbolForRow(p.data)) : '',
        cellClass: 'ledger-numeric',
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
          // Same fix as Item's own rule, for the same reason: this cell
          // renders on the add-item row now too, not just Item's.
          'ledger-add-row-collapsed': (p) =>
            p.data?.kind === 'add-item' && ledgerRowId(p.data) !== this.editingAddRowId(),
        },
      },
    ];

    for (const [personIndex, person] of people.entries()) {
      columns.push({
        colId: `person:${person.id}`,
        // The name lives in the header component, which is also where it is
        // edited; this is only what screen readers and menus fall back to.
        headerName: person.name || 'Unnamed',
        headerComponent: PersonHeader,
        headerComponentParams: { personId: person.id },
        headerClass: 'ledger-person-header',
        width: 40,
        // The one column left movable — reordering people is a drag on their
        // own header now, not a pair of arrows. {@link onColumnMoved} is what
        // carries the drop back into the trip's own order.
        suppressMovable: false,
        // Only the first person column's own colDef is read for a spanned
        // cell (AG Grid's rule, not this one) — see `colSpan` below — so
        // this function is what the whole merged block on an add-item row
        // actually renders through, and the plain `ledger-share` on every
        // other row is what each of the rest keeps on its own.
        cellClass: (p) => (p.data?.kind === 'add-item' ? 'ledger-add-row-people' : 'ledger-share'),
        // A share means nothing until there is an item to share — the
        // add-item row has none yet, so this whole block is merged into one
        // hatched cell rather than left as one still-editable-looking box
        // per person. Only the first column's own `colSpan` needs a real
        // count: the rest fall inside the block it opens and are never
        // themselves reached.
        colSpan:
          personIndex === 0
            ? (p: ColSpanParams<LedgerRowData>) => (p.data?.kind === 'add-item' ? people.length : 1)
            : undefined,
        // Nothing to type here yet, so — like the filler rows and the
        // add-person column — neither Tab nor the arrow keys should stop on
        // it. `onCellFocused` bounces the one way in that misses: a mouse
        // click, which AG Grid focuses before any handler here runs.
        // A colDef's own `suppressNavigable` replaces {@link defaultColDef}'s
        // rather than adding to it, so the filler-row half of that default
        // has to be repeated here explicitly, or a person column would start
        // catching Tab/arrow keys on filler rows it never used to.
        suppressNavigable: ((p) =>
          p.data?.kind === 'add-item' ||
          p.data?.kind === 'filler') satisfies SuppressNavigableCallback<LedgerRowData>,
        editable: (p) => p.data?.kind === 'item',
        valueGetter: (p: ValueGetterParams<LedgerRowData>) =>
          p.data?.kind === 'item'
            ? packShare(this.store.share(p.data.row.item.id, person.id))
            : null,
        // A share is a ratio and is left exactly as typed — putting a currency
        // symbol on `1.2` would be a lie about what it means.
        valueFormatter: (p) => (p.value == null ? '' : String(p.value)),
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
      width: ADD_PERSON_COLUMN_WIDTH,
      // AG Grid's own default minWidth is `min(36, rowHeight)` — wider than
      // this column is meant to be, and left alone it wins over `width`
      // above. Only `colDef.minWidth` overrides it (see `environment.ts`'s
      // `getDefaultColumnMinWidth` in ag-grid-community).
      minWidth: ADD_PERSON_COLUMN_WIDTH,
      editable: false,
      // Every one of its cells carries the same hatch as the filler beneath
      // a short block (see the `.ledger-add-person-cell` rule up top) — the
      // button that adds a person lives in the header, not down here, so
      // there is nothing on any row of this column to tab, arrow, or click
      // into. Unconditional, unlike {@link defaultColDef}'s own
      // `suppressNavigable`: that one only excludes the filler rows, this
      // column is untypeable on every row.
      suppressNavigable: true,
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
      // One undo step for the row, not two: adding the item and writing the
      // field just typed are one gesture from the user's side.
      this.store.transaction(() => {
        const item = this.store.addItem(data.sheetId);
        this.lastCreatedItemId = item.id;
        write(data.sheetId, item.id);
      });
      return true;
    }
    return false;
  }

  /** The symbol a row's amount is in — its sheet's, which need not be the trip's. */
  private symbolForRow(data: LedgerRowData): string {
    const sheet =
      'sheetId' in data ? this.store.sheets().find((s) => s.id === data.sheetId) : undefined;
    return sheet ? this.store.symbolFor(sheet) : this.store.baseSymbol();
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

function isUndoKey(event: KeyboardEvent): boolean {
  return (event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'z';
}

function isRedoKey(event: KeyboardEvent): boolean {
  const key = event.key.toLowerCase();
  return (
    (event.ctrlKey || event.metaKey) &&
    (key === 'y' || (event.shiftKey && key === 'z'))
  );
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
