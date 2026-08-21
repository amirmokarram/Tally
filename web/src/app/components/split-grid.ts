/**
 * The ledger — the whole trip in one grid.
 *
 * People, expense sheets and the owe/pay grid used to be three tabs. They were
 * always one thing: the Split sheet already *showed* all of it, and you had to
 * leave it to change any of it. Here the same grid is where it is typed:
 *
 *   - people are the columns, named from their headers and reordered from
 *     the toolbar's "Reorder → People" dialog;
 *   - each expense sheet spans a block of rows, its settings behind a popup
 *     editor on the spanned cell;
 *   - the last row of a block adds an item;
 *   - lines are ticked down the left and acted on together from the toolbar,
 *     which is where the buttons that used to ride every row now live.
 *
 * A cell in a person column holds the workbook's packed `owe.pay` number,
 * shown and typed as `owe|pay`: the first part is how much of the item that
 * person is on the hook for *relative to the others in the same row*, and the
 * second is how much of it they already paid. `2|1` therefore reads "owes two
 * shares, paid one" — but a side that is 0 is left out rather than spelled
 * out ({@link formatShare}), so the ordinary owe-only case reads as bare `1`,
 * not `1|0`. Typing the old `owe.pay` decimal still works — see {@link
 * parseShare} — so muscle memory from the original spreadsheet carries over.
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
  viewChildren,
} from '@angular/core';
import { AgGridAngular } from 'ag-grid-angular';
import {
  BodyScrollEvent,
  CellEditingStartedEvent,
  CellEditingStoppedEvent,
  CellFocusedEvent,
  CellKeyDownEvent,
  CellPosition,
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
  ColumnAutoSizeModule,
  ColumnResizedEvent,
  CustomEditorModule,
  EventApiModule,
  FullWidthCellKeyDownEvent,
  GetRowIdParams,
  GridApi,
  GridReadyEvent,
  IRowNode,
  IsRowValidDropPositionCallback,
  _KeyboardNavigationModule,
  ModuleRegistry,
  NumberEditorModule,
  RenderApiModule,
  RowApiModule,
  RowClassParams,
  RowDragCallback,
  RowDragEndEvent,
  RowDragModule,
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
import { buildExportPayload, downloadJson, exportFileName, slugifyTitle } from '../core/trip-file';
import { capturePng, saveImageFile } from '../core/report-export';
import { packShare, Share, unpackShare } from '../models/trip.model';
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
import { PersonReorderDialog } from './person-reorder-dialog';
import { SettingsPopup } from './settings-popup';
import { AddPersonHeader, PersonHeader } from './person-header';
import { IndexHeader } from './index-header';
import { CurrencyPicker } from './currency-picker';
import { ShareCellEditor } from './share-cell-editor';

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
  NumberEditorModule, // Amount
  CustomEditorModule, // the share cells' own editor — see `share-cell-editor.ts`
  // `api.getColumns()`, `api.getRowNode()`, `api.getCellValue()`. Nothing in
  // the app calls them — they are how the tests drive the real grid instead of
  // asserting against a mock of it, which is worth their small weight.
  ColumnApiModule,
  RowApiModule,
  CellApiModule,
  // `api.autoSizeColumns(['item'])` — shrinks the Item column to its actual
  // content for a PNG capture, in place of the `flex: 1` that otherwise lets
  // it stretch to fill whatever's left of the browser window; see
  // {@link SplitGrid.savePng}.
  ColumnAutoSizeModule,
  // `api.ensureColumnVisible` — a person added from the toolbar is a column off
  // the right-hand edge until the grid is scrolled to it.
  ScrollApiModule,
  // `api.refreshCells` — repaints the selected block as a drag moves over it.
  RenderApiModule,
  // `(bodyScroll)` — keeps the totals band lined up with the grid's own
  // columns when there are enough people to scroll sideways.
  EventApiModule,
  // Dragging a line by its number to reorder it within its sheet — see
  // {@link SplitGrid.onRowDragEnd}. Community, unlike AG Grid's own row
  // grouping, which is why the sheet blocks above are hand-rolled instead.
  RowDragModule,
  // `suppressNavigable` (keeps Tab/arrow keys off the filler beneath a short
  // block) and `api.clearFocusedCell()` (bounces a mouse click off the same
  // cells — see {@link SplitGrid.onCellFocused}). Leading underscore is AG
  // Grid's own naming.
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
 * 30-pixel column (set inline in {@link SplitGrid.columns}) since its header
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

/**
 * A ticked line's data, snapshotted by Copy/Cut so Paste can recreate it —
 * including in a different sheet, since shares live at trip level and stay
 * valid wherever the line lands.
 */
interface RowClipboardEntry {
  name: string;
  amount: number | null;
  shares: Record<string, Share>;
}

@Component({
  selector: 'app-split-grid',
  imports: [
    AgGridAngular,
    SheetEditor,
    SheetReorderDialog,
    PersonReorderDialog,
    CurrencyPicker,
    MoneyPipe,
    SettingsPopup,
  ],
  templateUrl: './split-grid.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    // The clipboard events are taken on the host rather than on the document:
    // they reach here by bubbling from the focused cell, so a copy aimed at
    // something else on the page is left alone. Delete/Backspace ride the
    // same bubble for the same reason — see {@link onKeyDown}. `(cut)` has no
    // cell-level meaning of its own — see {@link onCut} — but rides the same
    // bubble so Ctrl+X on ticked lines works the same way Ctrl+C/Ctrl+V do.
    '(copy)': 'onCopy($event)',
    '(cut)': 'onCut($event)',
    '(paste)': 'onPaste($event)',
    '(keydown)': 'onKeyDown($event)',
    // A drag can end anywhere, including outside the grid.
    '(document:mouseup)': 'endDrag()',
    '(document:keydown.escape)': 'onEscape()',
    // Every dropdown menu snapshots a fixed-position anchor (and the overflow
    // menu also snapshots which groups are collapsed) when they open — a
    // resize would leave any of them stale rather than tracking the button
    // that moved, so it closes them instead of trying to re-anchor.
    '(window:resize)':
      'closeAddMenu(); closeShareMenu(); closeExportMenu(); closeReorderMenu(); closeOverflowMenu()',
    '[class.dragging]': 'dragging || fillDragging',
    '[class.filling]': 'fillDragging',
    '[class.no-row-hover]': '!settings.rowHoverEnabled()',
    '[class.exporting-png]': 'capturing()',
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
      /* A scroll escape hatch for widths narrower than the icon-only
         collapse below can fit — rare, but the bar itself stays invisible
         (still scrollable by touch or trackpad) rather than showing a
         scrollbar in what reads as a row of buttons, not a scrolling
         region. */
      overflow-x: auto;
      overflow-y: hidden;
      scrollbar-width: none;
      -ms-overflow-style: none;

      &::-webkit-scrollbar {
        display: none;
      }

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

    /* Invisible to layout at normal widths — a group's buttons and divider
       sit directly in \`.toolbar-group\`'s own flex row, under its own \`gap\`,
       exactly as if this wrapper were not there. It exists only so the
       narrow-container breakpoints further down have one element per group
       to hide, collapsing each whole group into \`.toolbar-more\` as space
       runs out rather than wrapping or clipping button-by-button. */
    .toolbar-cluster {
      display: contents;
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
      padding: 6px 5px;
      border: 1px solid transparent;
      border-radius: var(--radius-sm);
      background: none;
      color: var(--text-muted);
      font-size: 13px;
      font-weight: 600;
      white-space: nowrap;

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

      /* Loses data when pressed — same convention as \`.btn.danger\` in
         styles.scss, reads like any other button until it is reached for. */
      &.danger:hover {
        background: var(--credit-bg);
        color: var(--credit);
      }
    }

    .toolbar-caret {
      opacity: 0.6;
    }

    /* Below this, the row stops fitting labels-and-all — "Reorder Sheets"
       (now just "Reorder", since the Reorder button folded People in behind
       its own dropdown the same way Export already did for its two formats;
       shorter only ever needs less room, so this is left loose rather than
       re-measured — see the same reasoning below for the four breakpoints
       after Save as PNG's merge) was the longest, so it is what the
       threshold was originally tuned against, measured
       (not derived, the same as the breakpoints below) with a margin above
       the point the row actually starts overflowing. Icons alone still say
       what each button does (their own \`title\` carries the rest), and
       shedding the labels buys back exactly the width that was overflowing
       rather than wrapping the toolbar onto a second line. The currency
       picker is deliberately untouched: it is already as compact as it gets
       (see \`.currency-select\` below), and it is what the trip's numbers are
       in — not something to hide under pressure.

       This one was 620px for a long time before Delete and Shares joined
       the row (see \`.toolbar-cluster\`, below) without it being re-measured
       against them — the same gap the breakpoints below already had to be
       fixed for, just wider: up to 251px of the labeled row could overflow,
       scrolled invisibly out of view behind the (invisible) escape-hatch
       scrollbar, before label-shedding ever got a chance to reclaim the
       space. Re-measure this (and every breakpoint below) whenever a button
       is added to or removed from the row — it moved again, to 1020px,
       when Add joined \`.cluster-1\`. */
    @container (max-width: 1020px) {
      .toolbar-btn .btn-label {
        display: none;
      }

      .toolbar-btn {
        padding-inline: 8px;
      }
    }

    /* Hidden until the row runs out of room even icon-only — the widest of
       the four breakpoints below sets it to \`inline-flex\` once the first
       group collapses, and it stays that way through the narrower ones too
       (an \`@container\` rule that has already matched keeps applying as the
       container keeps shrinking, since \`max-width\` conditions are
       cumulative), the same one button standing in for however many groups
       are currently stacked in its menu — see \`overflowedClusters\`, on the
       host. */
    .toolbar-more {
      display: none;
    }

    /* Each \`.toolbar-cluster\` is \`display: contents\` normally — invisible to
       layout, its buttons and divider sitting directly in \`.toolbar-group\`'s
       own flex row exactly as if the wrapper were not there. Four
       breakpoints, one per group, widest first — group 4 (Reorder
       Sheets/Export) goes first since it was placed last and least central,
       group 1 (Add/Delete/Shares) goes last since it was placed first. Each
       collapses its own group into \`.toolbar-more\`'s menu instead of
       clipping or wrapping, on top of whatever narrower breakpoints already
       collapsed. Currency and Settings are deliberately untouched, the same
       reasoning as the 1020px breakpoint above: not something to hide under
       pressure.

       The numbers themselves are measured, not derived: each is the
       narrowest width at which everything down to that group still
       rendered without the row overflowing, in the icon-only state the
       1020px breakpoint already put it in, plus a margin for
       \`.toolbar-more\` itself, which is not on the page to measure until
       the first of these already applies. Cutting a breakpoint too close
       leaves a gap where the row genuinely overflows before it fires — a
       real bug this had twice already, at a cruder single 480px cutoff and
       then again for the labeled row itself when Delete and Shares first
       joined it without this number being re-measured: content quietly
       scrolled out of view behind the (invisible) escape-hatch scrollbar,
       one button (or one whole labeled row) at a time as the window
       narrowed, rather than moving into the menu. Re-measure these whenever
       a button is added to or removed from the row.

       Left unchanged, deliberately, when Save as PNG merged into Export's
       own dropdown (group 4 is back down to two buttons): a narrower row
       only ever needs *less* room than these numbers already give it, so
       collapsing here is now a touch earlier than strictly necessary rather
       than genuinely too late — confirmed by measuring the row at each of
       the four breakpoints below with the merge in place: it fits with
       room to spare every time, never the reverse. Safe to leave loose;
       tightening them would need the same real re-measurement as widening
       always has, not a guess at how much the row shrank. */
    @container (max-width: 600px) {
      .cluster-4 {
        display: none;
      }

      .toolbar-more {
        display: inline-flex;
      }
    }

    @container (max-width: 535px) {
      .cluster-3 {
        display: none;
      }
    }

    @container (max-width: 405px) {
      .cluster-2 {
        display: none;
      }
    }

    @container (max-width: 310px) {
      .cluster-1 {
        display: none;
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
      flex-direction: column;
      align-items: flex-start;
      justify-content: center;
      gap: 1px;
      padding: 0 5px;
    }

    .grand-label {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--text-muted);
    }

    .grand-amount {
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
       below. This same rule now carries phones too — see app.scss's own
       \`@media\` override for \`:host\`/\`main\`, which turned \`main\` into a
       \`min-height\`-based flex column so this \`flex: 1\` has real leftover
       space to fill there as well, rather than the fixed \`vh\`-minus-a-
       constant height this used on phones before. That constant was always
       a guess at the header/toolbar/totals-band's real height, which
       changes with content (a wrapped title, a warning line) — wrong by
       just 16px it left a visible gap once the phone view below went
       edge-to-edge. */
    .grid {
      display: block;
      width: 100%;
      flex: 1;
      min-height: 0;
    }

    /* Edge-to-edge on a phone. \`main\` itself drops its own padding around
       the report there (app.scss, scoped with \`:has()\` to just this tab) —
       squaring off \`.report\`'s corners and shadow here is what actually
       makes it read as flush rather than a card floating on the page. */
    @media (max-width: 640px) {
      .report {
        border-radius: 0;
        box-shadow: none;
      }

      .report-toolbar {
        border: none;
        border-radius: 0;
      }

      .totals-band {
        border: none;
      }

      :host ::ng-deep .ag-root-wrapper {
        border: none;
        border-radius: 0;
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

    /* The report, flattened for a PNG capture — see \`savePng\`. The toolbar
       goes, and \`.report\`/\`.grid\` trade their normal viewport-clamped
       sizing (\`height: 100%\`/\`flex: 1\`, both meant for a page that scrolls
       internally) for their natural content size, since the whole point of
       the capture is a full, unclipped image. \`.totals-band\`'s own
       \`overflow-x: hidden\` — there so a wide trip's band clips the same way
       the grid's body does, in step with \`onBodyScroll\` — is lifted for the
       same reason: nothing left to stay in step with once the grid itself
       has nothing to scroll. The row-drag handle and the sheet cell's own
       "⋯" (opens the sheet editor popup — nothing to open in a still image)
       are pure decoration with no effect on any row or column size, so a
       plain hide is all either needs — unlike the add-item rows and the
       whole add-person column, which are filtered out of the row/column
       data instead (see {@link printRows}, {@link printColumns}) rather
       than hidden here, since hiding their DOM would leave a gap (the
       add-item row) or a blank navy sliver nobody's data ever occupied (the
       add-person column) rather than actually closing up the space, and
       unlike the sheet cell's own *height*, which the "⋯" button sits
       inside of but does not affect — see \`sheet-cell.ts\`'s \`isCapturing\`.
       The Sheet column's own add-sheet "+" is the remaining exception among
       the header icons: that column holds real data (the sheet names) and
       stays, so only its button needs hiding, the same as the sheet cell's
       own "⋯".

       \`.report\` itself needs \`width: max-content\` too, not just \`.grid\`
       (below) — html-to-image sizes the captured canvas off {@link
       reportRoot}'s own \`getBoundingClientRect()\`, and \`.report\` is still
       an ordinary in-flow block filling whatever width \`:host\` has left over
       from the page around it. A wide trip's grid growing past that edge was
       genuinely dropped from the PNG, not just visually clipped on screen —
       \`overflow: visible\` (as on \`.totals-band\` above) only stops a *box*
       from clipping content past its own edge; it does nothing for a
       still-too-narrow *ancestor* the capture is actually measuring. */
    :host(.exporting-png) .report-toolbar {
      display: none;
    }

    :host(.exporting-png) .report {
      height: auto;
      width: max-content;
    }

    /* \`width\` here is a fallback only — \`captureGridWidth\`'s inline
       \`[style.width.px]\` binding (\`split-grid.html\`) is what actually wins in
       practice, and is why \`.report\`'s own \`max-content\` above resolves
       correctly at all. Left to AG Grid's own markup, \`max-content\` on this
       element cannot see past it: \`.ag-root-wrapper\` and everything inside it
       are \`width: 100%\` of *this* element, so without an explicit number of
       our own, \`max-content\` has nothing but a 100%-of-itself child to size
       itself against and collapses to the smallest thing that satisfies
       that — which is not the grid's real content width. \`captureGridWidth\`
       sidesteps the whole ambiguity by reading AG Grid's own column widths
       directly, the same reasoning {@link itemColumnWidth} already follows
       for the totals band. */
    :host(.exporting-png) .grid {
      flex: none;
      height: auto;
      width: max-content;
    }

    :host(.exporting-png) .totals-band {
      overflow-x: visible;
    }

    :host(.exporting-png) ::ng-deep .ag-drag-handle,
    :host(.exporting-png) ::ng-deep app-add-sheet-header,
    :host(.exporting-png) ::ng-deep app-sheet-cell button.more {
      display: none;
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

    /* The transparent click-catcher behind the Shares dropdown and the
       overflow menu — nothing to dim, since unlike the editor panel neither
       is a modal over the grid, just a way to notice a click elsewhere and
       close whichever is open. */
    .toolbar-menu-backdrop {
      position: fixed;
      inset: 0;
      z-index: 55;
    }

    .toolbar-menu {
      position: fixed;
      z-index: 56;
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 150px;
      padding: 6px;
      background: var(--surface);
      border: 1px solid var(--border-strong);
      border-radius: var(--radius-sm);
      box-shadow: 0 8px 24px rgb(20 53 95 / 20%);
    }

    .toolbar-menu .btn {
      width: 100%;
      justify-content: flex-start;
    }

    /* The overflow menu stacks every \`.toolbar-actions\` button at once
       (see the 480px breakpoint, above), so it is taller than the two-item
       Shares dropdown reusing the rest of \`.toolbar-menu\` — this is its own
       width and a cap on how tall it can grow before scrolling. */
    .overflow-menu {
      width: 200px;
      max-height: calc(100vh - 20px);
      overflow-y: auto;
    }

    .toolbar-menu-divider {
      height: 1px;
      margin: 4px 2px;
      background: var(--border);
    }

    /* Points at the Shares row's own further popup — the same down chevron
       \`.toolbar-caret\` draws on the toolbar button, quarter-turned to read
       as "opens more" rather than "opens downward" the way it does there. */
    .menu-submenu-caret {
      margin-left: auto;
      opacity: 0.6;
      transform: rotate(-90deg);
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
    :host ::ng-deep .ledger-add-row-index.ag-cell-focus,
    :host ::ng-deep .ledger-index.ag-cell-focus {
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

    /* A line a Cut has marked to go but not yet moved — a light gray bar on
       the trailing edge of its own line-number cell (see the \`index\`
       column's own \`cellClassRules\`), so the line still visibly reads as
       "there" (Paste, elsewhere, is what actually removes it; Esc calls it
       off) rather than looking like an ordinary one. \`border-inline-style\`
       is what actually draws it: a color/width with no style renders
       nothing, and nothing else here can be relied on to have already set
       one on this cell's inline edges. */
    :host ::ng-deep .ledger-cut-pending {
      border-inline-style: solid;
      border-inline-width: 3px;
      border-inline-color: transparent lightgray;
    }

    /* A line a Copy last put on the row clipboard — the same line-number
       bar as a Cut's own \`.ledger-cut-pending\`, in green instead of gray
       so the two read as different things at a glance. */
    :host ::ng-deep .ledger-copied {
      border-inline-style: solid;
      border-inline-width: 3px;
      border-inline-color: transparent lightgreen;
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

    :host ::ng-deep .ag-cell {
      align-content: center;
    }

    /* The handle's own default right margin left too much air before the
       item name next to it. */
    :host ::ng-deep .ag-drag-handle {
      margin-right: 5px;
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

    /* Not \`--ag-cell-horizontal-padding\`: AG Grid's own theme subtracts a
       pixel from that variable before it reaches \`padding\` (border
       compensation), so setting it to 5px renders as 4px. Set directly
       instead, which wins on specificity over the theme's own rule.
       Dropped only while the cell is showing its value, not while it holds
       the editor — same rule \`.ledger-share\` follows below, for the same
       reason: the input still wants AG Grid's own, roomier padding around
       it, not this column's tighter resting one. */
    :host ::ng-deep .ledger-item:not(.ag-cell-inline-editing) {
      padding-left: 5px;
      padding-right: 5px;
    }

    :host ::ng-deep .ledger-numeric {
      font-variant-numeric: tabular-nums;
      justify-content: flex-end;
    }

    :host ::ng-deep .ledger-numeric:not(.ag-cell-inline-editing) {
      padding-left: 5px;
      padding-right: 5px;
    }

    :host ::ng-deep .ledger-share {
      font-variant-numeric: tabular-nums;
      font-weight: 600;
      justify-content: center;
      /* The value is a bare text node, not a flex child, so justify-content
         above has nothing to act on — this is what actually centers it. */
      text-align: center;
    }

    /* A person column is 30 pixels wide, and AG Grid's 15 either side leaves
       a share reading "9.9" nowhere to go but off the edge. Dropped only
       while the cell is showing its value, not while it holds the editor —
       that still wants room around the input. */
    :host ::ng-deep .ledger-share:not(.ag-cell-inline-editing) {
      --ag-cell-horizontal-padding: 0px;
    }

    /* \`.ag-text-field-input\`'s own theme padding (8px either side) is meant
       for a full-width text field, not a 30-pixel share editor — it leaves a
       two-character "9.9" nowhere to go but clipped. */
    :host ::ng-deep .ledger-share.ag-cell-inline-editing input {
      text-align: center;
      padding-left: 0;
      padding-right: 0;
    }

    /* Reused by the totals band above the grid — see \`.totals-band .person\`
       in \`split-grid.html\` — for the same red the workbook used for someone
       who is owed rather than owing. */
    :host ::ng-deep .ledger-credit {
      color: var(--credit);
    }

    /* The selected block. An inset ring rather than a fill, so the paid and
       unassigned colours underneath still read through it. Dropped once the
       cell is showing its editor: AG Grid draws its own border around an
       editing cell, and the editor's own input carries a focus ring of its
       own too — both already the same navy-700 this ring uses, so left on
       top of them it reads as one thick, doubled border rather than the
       thin single one this is everywhere else. */
    :host ::ng-deep .ledger-selected:not(.ag-cell-inline-editing) {
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

    /* Not drawn on an editing cell: there is nothing to drag-fill while the
       cell holds a text editor rather than a value, so the square left over
       from before the double-click just reads as one more stray border. */
    :host ::ng-deep .ledger-fill-handle:not(.ag-cell-inline-editing)::after {
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

    /* AG Grid's own editing-cell chrome — rounded corners plus a drop
       shadow — is the only rounded, shadowed thing anywhere in this grid;
       every other border here is square, flat and 1px. Flattened to match:
       the cell's own border is cue enough that it holds an editor without
       AG Grid's own default styling standing out against the rest of the
       sheet. \`!important\` for the same reason as the other overrides
       above — AG Grid's own rule matches the same class. */
    :host ::ng-deep .ag-cell-inline-editing {
      border-radius: 0 !important;
      box-shadow: none !important;
    }

    /* The input AG Grid drops inside an editing cell carries this same
       rounded-corner-plus-glow chrome a second time, independently of the
       cell's own — flattening the cell above left a rounded, glowing input
       sitting inside an otherwise square cell, which reads worse than the
       doubled border it replaced. The cell's own flat 1px border above is
       cue enough that it holds an editor; the input needs none of its own. */
    :host ::ng-deep .ag-cell-inline-editing input {
      border: none !important;
      border-radius: 0 !important;
      box-shadow: none !important;
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
       the title through \`.ag-header-cell-label\`'s own \`justify-content: flex-end\`
       — the one part of the type this column keeps only for its cell values,
       not its title. \`.ag-header-cell-text\` only shrink-wraps its own
       content, so centering has to target the flex container, not the span. */
    :host ::ng-deep .ledger-amount-header .ag-header-cell-label {
      justify-content: center;
    }

    /* \`.ag-header-cell\`'s own theme default (16px each side) swallows most
       of this column's 80px width before the label ever sees it — overriding
       padding on the label only stacks 5px on top of that 16px. The literal
       "0 5px" has to land on \`.ledger-amount-header\` itself, since that
       class is the header cell element, to actually replace it. */
    :host ::ng-deep .ledger-amount-header {
      padding: 0 5px;
    }

    /* The Item column's header defaults to left-aligned, matching its own
       left-aligned text values — the title itself reads better centered.
       \`.ag-header-cell-text\` only shrink-wraps its own content, so
       \`text-align\` on the span is a no-op once the column (and its flex
       label container) is wider than the word "Item"; centering the flex
       container itself is what actually moves the text. */
    :host ::ng-deep .ledger-item-header .ag-header-cell-label {
      justify-content: center;
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
       is 30 pixels wide, and AG Grid's 16 either side would consume the
       header component entirely instead of leaving it the 30 it is sized
       for. */
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
  protected readonly sheetReorderOpen = signal(false);

  /** Whether the person-reorder dialog — see `person-reorder-dialog.ts` — is open. */
  protected readonly personReorderOpen = signal(false);

  /** The block of cells a copy or a paste applies to, or null. */
  private readonly selection = signal<CellRange | null>(null);

  /**
   * The sheet whose add-item row was last clicked — {@link pasteAnchor}'s
   * last resort, for a sheet with no lines yet to select a cell on at all.
   * Cleared whenever a real cell selection replaces it (see {@link select});
   * left alone by everything else, since as the lowest-priority fallback a
   * stale value here only matters when nothing else says where to paste.
   */
  private readonly addRowFocus = signal<{ sheetId: string } | null>(null);

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

  /**
   * The line a Shift+click on the line number column extends a range from —
   * the last line ticked by a plain or Ctrl/Cmd click there. Not touched by
   * a Shift+click itself, so a second one from the same starting point can
   * still grow or shrink the range instead of re-anchoring to wherever the
   * first Shift+click landed.
   */
  private rowSelectionAnchor: IRowNode<LedgerRowData> | null = null;

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

  /**
   * The `.report` div — totals band plus grid, nothing else — captured by
   * {@link savePng}. Toolbar, popups and the alerts overlay all sit outside
   * it, so nothing about this ref needs to change to keep them out of frame.
   */
  private readonly reportRoot = viewChild<ElementRef<HTMLElement>>('reportRoot');

  /**
   * Puts the report into its flattened, print-ready shape — see the
   * `:host(.exporting-png)` styles below, and {@link printRows} — for as long
   * as the DOM is actually being rasterized. Deliberately narrower than
   * {@link exportingPng}: once {@link capturePng} has the image, nothing
   * about the *save* step (which can sit open for as long as a native picker
   * takes to be answered) needs the report still flattened, so this reverts
   * the moment the pixels are captured rather than staying flattened behind
   * whatever comes next — a user opening the picker should find the ordinary,
   * editable report waiting under it, not the toolbar-less one.
   */
  protected readonly capturing = signal(false);

  /**
   * True for the whole export — capture *and* save — so a second click can't
   * start an overlapping capture while the first one is still saving (a
   * native picker, in particular, can stay open indefinitely). What the PNG
   * button's own `disabled` binding reads; {@link capturing} is reserved for
   * the report's own flattened *appearance*, which ends well before this
   * does.
   */
  protected readonly exportingPng = signal(false);

  /**
   * The grid's own total column width while {@link capturing} — read
   * straight from AG Grid's column API (`getActualWidth()` summed across
   * every column) rather than left for the `.grid` element to work out for
   * itself. Left to intrinsic sizing (`width: max-content`, in the
   * `:host(.exporting-png)` styles below), a wide trip's grid stayed clipped
   * to its normal, viewport-scrolled width instead of growing to fit every
   * column: `.ag-root-wrapper` and everything AG Grid renders inside `.grid`
   * is `width: 100%` of it, so with nothing but a 100%-of-itself child to
   * measure, `max-content` has no real content width to resolve against.
   * Reading the number straight from the grid, the same reasoning {@link
   * itemColumnWidth} already follows for the totals band, sidesteps that
   * ambiguity entirely — see the `[style.width.px]` binding on `<ag-grid-angular>`
   * in `split-grid.html`.
   */
  protected readonly captureGridWidth = signal<number | null>(null);

  /** The sum of every column's real width, or `null` before the grid has any. */
  private totalColumnWidth(): number | null {
    const columns = this.api?.getColumns() ?? [];
    return columns.length ? columns.reduce((sum, column) => sum + column.getActualWidth(), 0) : null;
  }

  /**
   * Shrinks Item to its actual content, for a PNG capture.
   *
   * Item's own `flex: 1, minWidth: 150` (see `columns`, below) is built for
   * the live report, where it should fill whatever space a person's own
   * browser window leaves over — exactly what makes it wrong for a still
   * image, where that leftover space is just dead air around the text and
   * extra pixels in the file for no reason. `autoSizeColumns` measures every
   * row now in the DOM (the grid must already be in its print layout — see
   * `savePng`) and sizes Item to the widest of them instead.
   *
   * `refreshItemColumnWidth` is what carries the new width to `totalsColumns`
   * (the totals band's own `grid-template-columns`), which reads that signal
   * for Item's width rather than the grid directly — without it, the band
   * stays at Item's old, flexed-out width, wider than the now-shrunk grid
   * underneath it, and `.report`'s own `max-content` (`:host(.exporting-png)`,
   * below) picks the band's stale width over the grid's real one.
   */
  private shrinkItemColumnToContent(): void {
    this.api?.autoSizeColumns(['item']);
    this.refreshItemColumnWidth();
  }

  /**
   * Undoes {@link shrinkItemColumnToContent}. `autoSizeColumns` pins Item to
   * a fixed pixel width, the same way a manual drag on its own border would —
   * overriding its own `flex: 1` until told otherwise, and unaffected by
   * anything `autoSizeColumns` did to AG Grid's own internal state, so
   * simply reverting {@link capturing} is what hands it back: the grid's
   * `[columnDefs]` binding is capturing-aware too (`printColumns()`/
   * `columns()`, in `split-grid.html`), and once `capturing` is false again
   * that binding is back to the grid's real definitions on its own.
   *
   * Two ticks, not one, are what let that binding actually reach AG Grid
   * before `refreshItemColumnWidth` reads anything off the result: `capturing`
   * changing is the signal write itself, one tick is Angular noticing and
   * pushing the new `columnDefs` into `ag-grid-angular`, and the second is
   * AG Grid actually applying them — confirmed the hard way, when one tick
   * alone left `refreshItemColumnWidth` reading Item's width a whole
   * change-detection cycle too early, back when it *did* still hold the
   * shrunk number. This also used to push the same definitions again
   * itself, imperatively, which seemed harmless (the same array, headed to
   * the same place either way) but let AG Grid process the same restore
   * twice in close succession, which is what actually left a duplicate
   * add-person header behind, not the restore itself.
   */
  private async restoreItemColumn(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve));
    await new Promise((resolve) => setTimeout(resolve));
    this.refreshItemColumnWidth();
  }

  /**
   * Saves the report as a PNG, named after the split.
   *
   * `capturing` flips the grid into its print layout — no scroll, no
   * virtualised columns, no add-item rows (`printRows`), no add-person
   * column (`printColumns`) — and the report's own CSS out of its
   * viewport-clamped size and into its natural one. Four macrotasks, one per
   * step below that changes something the *next* step depends on, give
   * Angular and AG Grid time to actually apply each before moving on: the
   * row/column/layout bindings before every row is in the DOM to measure,
   * the Item auto-size before its new width is summed, and that sum before
   * the grid is actually resized to it — {@link restoreItemColumn} needs two
   * more of its own afterwards, for the same reason, to undo it. A macrotask
   * (`setTimeout`), not an animation frame: the same reasoning as `settle()`
   * in `split-grid.spec.ts` — a `requestAnimationFrame` only fires once the tab
   * is actually compositing, which a backgrounded or occluded one may delay
   * far longer than this needs to wait for. The inner `finally` is what
   * guarantees the grid always reverts to its normal, editable layout even
   * if the capture itself throws — a stuck-in-print-mode grid would be a far
   * worse failure than a missing PNG — and, on the happy path, is what lets
   * that revert happen before the save step below rather than after it.
   */
  protected async savePng(): Promise<void> {
    if (this.exportingPng()) {
      return;
    }
    const node = this.reportRoot()?.nativeElement;
    if (!node) {
      return;
    }

    this.exportingPng.set(true);
    try {
      this.capturing.set(true);
      let blob: Blob;
      try {
        // Every row has to actually be in the DOM before `autoSizeColumns`
        // below can measure the Item column's real content — the two ticks
        // are what let the `printRows`/`domLayout: 'print'` bindings above
        // reach AG Grid and get there.
        await new Promise((resolve) => setTimeout(resolve));
        await new Promise((resolve) => setTimeout(resolve));

        this.shrinkItemColumnToContent();
        // Lets that resize actually reach the DOM before the total below is
        // read off it, and before the capture reads pixels.
        await new Promise((resolve) => setTimeout(resolve));

        // Read after the resize above, not before: `totalColumnWidth` sums
        // every column's *current* actual width, and Item's only just
        // changed.
        this.captureGridWidth.set(this.totalColumnWidth());
        await new Promise((resolve) => setTimeout(resolve));

        blob = await capturePng(node);
      } finally {
        this.capturing.set(false);
        this.captureGridWidth.set(null);
        await this.restoreItemColumn();
      }
      await saveImageFile(blob, `${slugifyTitle(this.store.title())}.png`);
    } finally {
      this.exportingPng.set(false);
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
   * grid's own model and {@link columns} — but not always in the header DOM:
   * told to insert a column ahead of one already there, AG Grid updates its
   * column model straight away and leaves the header cells themselves in the
   * old order until something asks them to repaint. One deferred
   * `refreshHeader` call — the same task the column model itself needed to be
   * ready for — lands too early to fix it here; the model is ready but the
   * header's own DOM apparently is not. A second, later one is what actually
   * takes.
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
   * Persists a line drag: `rowDragManaged` has already reordered the grid's
   * own row model by the time this fires, so the new position is read back
   * off the grid and diffed against the sheet's still-unchanged stored order.
   * `isRowValidDropPosition` keeps every drop inside the dragged line's own
   * sheet, so the two ids being compared are always the same list.
   */
  protected onRowDragEnd(event: RowDragEndEvent<LedgerRowData>): void {
    const dragged = event.node.data;
    if (dragged?.kind !== 'item') {
      return;
    }
    const sheetId = dragged.sheetId;
    const itemId = dragged.row.item.id;
    const order: string[] = [];
    event.api.forEachNode((node) => {
      if (node.data?.kind === 'item' && node.data.sheetId === sheetId) {
        order.push(node.data.row.item.id);
      }
    });
    const items = this.store.sheets().find((sheet) => sheet.id === sheetId)?.items ?? [];
    const from = items.findIndex((item) => item.id === itemId);
    const to = order.indexOf(itemId);
    if (from >= 0 && to >= 0 && from !== to) {
      this.store.moveItem(sheetId, itemId, to - from);
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
    // otherwise toggle a line's tick off or start a cell-range drag on what
    // was meant as a right-click for the browser's own context menu.
    if ((event.event as MouseEvent | null)?.button !== 0) {
      return;
    }
    // The line number column holds no pasteable value, so a click there ticks
    // the line instead of starting a cell block — the same job the removed
    // checkbox column used to do, just moved onto a column that already has
    // its own reason to be clicked. Plain, Shift, and Ctrl/Cmd clicks follow
    // the usual row-picker convention (Explorer, Gmail, spreadsheets): plain
    // replaces the tick with just this line, Shift extends it as a range from
    // {@link rowSelectionAnchor}, and Ctrl/Cmd toggles this one line without
    // touching the rest.
    if (event.column.getColId() === 'index') {
      if (event.node.data?.kind === 'item') {
        const native = event.event as MouseEvent | null;
        if (native?.shiftKey && this.rowSelectionAnchor?.data?.kind === 'item') {
          this.selectRowRange(this.rowSelectionAnchor, event.node);
        } else if (native?.ctrlKey || native?.metaKey) {
          event.node.setSelected(!event.node.isSelected());
          this.rowSelectionAnchor = event.node;
        } else {
          event.node.setSelected(true, true);
          this.rowSelectionAnchor = event.node;
        }
      }
      return;
    }
    const ref = this.cellRef(event.node, event.column.getColId());
    if (!ref) {
      // Nothing to select on an add-item row, but a click there still says
      // *which sheet* — the only way to point a Paste at one with no lines
      // yet, since there is no line to select a cell on. See {@link
      // pasteAnchor}.
      if (event.node.data?.kind === 'add-item') {
        this.addRowFocus.set({ sheetId: event.node.data.sheetId });
      }
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

  /**
   * Ticks every line between `anchor` and `target`, inclusive, replacing
   * whatever was ticked before — the range a Shift+click on the line number
   * column selects. Rows in between that are not lines (the add-item row,
   * a sheet heading) are skipped rather than breaking the range.
   */
  private selectRowRange(anchor: IRowNode<LedgerRowData>, target: IRowNode<LedgerRowData>): void {
    if (anchor.rowIndex == null || target.rowIndex == null) {
      return;
    }
    const [start, end] =
      anchor.rowIndex <= target.rowIndex ? [anchor.rowIndex, target.rowIndex] : [target.rowIndex, anchor.rowIndex];
    this.api?.deselectAll();
    for (let i = start; i <= end; i++) {
      const node = this.api?.getDisplayedRowAtIndex(i);
      if (node?.data?.kind === 'item') {
        node.setSelected(true);
      }
    }
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
   * beneath a short block, the add-person column, the index column on every
   * row (a click there ticks the line — see {@link onCellMouseDown} — it is
   * a button, not a value to read or navigate into), and — on an add-item
   * row — the merged block of person columns beside it, hatched the same
   * way for the same reason, see {@link columns}'s `add-person` entry.
   *
   * `suppressNavigable` (on {@link defaultColDef} for the filler rows, on
   * the `add-person` column itself for every row, on the index column for
   * every row, and on the person columns for an add-item row) already keeps
   * Tab and the arrow keys from stopping on any of them. A mouse click is
   * the one way in none of them covers, since AG Grid focuses the cell as
   * part of its own mousedown handling, before `(cellMouseDown)` — an
   * output, not a hook — gets a chance to react. Clearing it back out here
   * is a click late, but a click late is as early as there is.
   *
   * Leaving the index cell as AG Grid's own tracked "focused cell" was worse
   * than the one-frame flicker this bounces away: AG Grid restores real DOM
   * focus to whatever cell it still considers focused on every refresh —
   * including one ticking a line itself triggers, by changing totals
   * elsewhere on the grid — so the last line ticked kept re-stealing focus
   * back onto its own number cell (and the focus ring with it) long after
   * the click that ticked it. Bouncing focus off it here means there is
   * nothing left for a later refresh to restore.
   */
  protected onCellFocused(event: CellFocusedEvent<LedgerRowData>): void {
    if (event.rowIndex == null) {
      return;
    }
    const colId = typeof event.column === 'string' ? event.column : event.column?.getColId();
    if (colId === 'add-person' || colId === 'index') {
      this.api?.clearFocusedCell();
      return;
    }
    const node = this.api?.getDisplayedRowAtIndex(event.rowIndex);
    if (node?.data?.kind === 'filler') {
      this.api?.clearFocusedCell();
      return;
    }
    if (node?.data?.kind === 'add-item' && colId?.startsWith('person:')) {
      this.api?.clearFocusedCell();
    }
  }

  /** The four keys {@link onCellKeyDown} reacts to. */
  private static readonly ARROW_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

  /**
   * Keeps {@link selection} — the hand-rolled block a copy/paste/fill reads,
   * painted by `ledger-selected` — following an arrow key the way Excel's
   * own selection does: plain movement restarts the block as a single cell
   * at wherever focus lands, and held Shift instead keeps the block's
   * existing anchor and only drags the far corner to the new cell, growing
   * or shrinking it around a fixed corner the same way a shift-click
   * already does in {@link onCellMouseDown}.
   *
   * Reads the *result* of AG Grid's own navigation rather than computing it
   * — `(cellKeyDown)` is an output, not a hook, so by the time it fires AG
   * Grid's internal keydown listener has already moved the focused cell,
   * the same ordering {@link commitAddItemRow}'s doc comment leans on to
   * explain why *preventing* default has to happen earlier, through
   * `suppressKeyboardEvent`, instead. Nothing here needs to prevent
   * anything, so the ordering works in this direction's favour instead:
   * `getFocusedCell` already reflects wherever the press landed, filler
   * rows and the index/add-person columns already skipped by
   * `suppressNavigable`, with no need to re-walk the grid to find it.
   *
   * The add-item row is deliberately left navigable (Item/Amount only —
   * see {@link columns}) so a plain arrow key can still land on it the way
   * clicking it always could: it is where a new line starts. Held Shift is
   * the one case that has to skip it anyway, through {@link
   * skipAddItemRow} — a block being dragged out for a copy or a fill has
   * nothing to reach for on a row with no line on it yet, so growing the
   * block onto it would just be a cell a paste would silently do nothing
   * with. `suppressNavigable` cannot make that distinction itself, since it
   * is asked before AG Grid knows whether the key held Shift.
   */
  protected onCellKeyDown(
    event: CellKeyDownEvent<LedgerRowData> | FullWidthCellKeyDownEvent<LedgerRowData>,
  ): void {
    const native = event.event as KeyboardEvent | null;
    if (!native || !SplitGrid.ARROW_KEYS.has(native.key)) {
      return;
    }
    let focused = this.api?.getFocusedCell();
    if (!focused) {
      return;
    }
    if (native.shiftKey) {
      focused = this.skipAddItemRow(focused, native.key);
      if (!focused) {
        // Nowhere further to grow: the block correctly stays put, but AG
        // Grid's own default navigation already moved its *own* focus onto
        // the add-item row before this handler ran, and {@link
        // skipAddItemRow} only corrects that when it finds somewhere to
        // land — never told, it leaves that focus outline sitting on the
        // add-item row, reading as though the row had joined the selection
        // even though the ring itself never grew onto it.
        this.restoreFocusToSelectionHead();
        return;
      }
    }
    const node = this.api?.getDisplayedRowAtIndex(focused.rowIndex);
    const ref = node && this.cellRef(node, focused.column.getColId());
    if (!ref) {
      // A plain arrow onto the add-item row is a real move — the ring has
      // to leave the row behind it the same way a click on nothing already
      // clears it in {@link onCellMouseDown}, or the old block is left
      // stranded on a line that isn't focused anymore, looking selected
      // right alongside wherever focus actually just landed. Shift instead
      // leaves it alone: {@link skipAddItemRow} above means this is only
      // ever reached, under Shift, once there is nowhere further to grow
      // toward, and stopping there is the point, not a stray cell to clear.
      if (!native.shiftKey) {
        this.select(null);
      }
      return;
    }
    const anchor = (native.shiftKey && this.selection()?.anchor) || ref;
    this.select({ anchor, head: ref });
  }

  /**
   * Carries a Shift-held focus on past the add-item row, in whichever
   * direction it was already heading, to the next real line — or, if the
   * row it landed on is not that row at all, hands the position straight
   * back unchanged.
   *
   * Only Up and Down ever need to move again: the add-item row is a whole
   * row, so Left and Right only ever reach it by already sitting on it, not
   * by arriving there fresh, and this is only asked to react to a fresh
   * arrival (see {@link onCellKeyDown}). Moves AG Grid's own focus along
   * with the return value, through `setFocusedCell` — the block this feeds
   * is not the only thing reading "where the cursor is": leaving the two
   * disagreeing would strand a later Tab or Enter on a row this already
   * decided has nothing on it.
   *
   * Returns null at the edge of the grid, the same as running out of rows
   * for a plain arrow key would — nothing further to land on, so the block
   * simply stops growing rather than jumping somewhere unrelated.
   */
  private skipAddItemRow(cell: CellPosition, key: string): CellPosition | null {
    const api = this.api;
    const node = api?.getDisplayedRowAtIndex(cell.rowIndex);
    if (!api || node?.data?.kind !== 'add-item') {
      return cell;
    }
    const step = key === 'ArrowDown' ? 1 : key === 'ArrowUp' ? -1 : 0;
    if (step === 0) {
      return cell;
    }
    let rowIndex = cell.rowIndex + step;
    let next = api.getDisplayedRowAtIndex(rowIndex);
    while (next && next.data?.kind !== 'item') {
      rowIndex += step;
      next = api.getDisplayedRowAtIndex(rowIndex);
    }
    if (!next) {
      return null;
    }
    api.setFocusedCell(rowIndex, cell.column.getColId());
    return { ...cell, rowIndex };
  }

  /**
   * Moves AG Grid's own focus back onto wherever {@link selection}'s head
   * already is — see the call site in {@link onCellKeyDown} for why this is
   * needed at all: AG Grid's own focus and this component's own block are
   * two separate things that are supposed to track together, and the one
   * path that does not keep them in sync is a Shift+arrow that runs out of
   * lines to grow into.
   */
  private restoreFocusToSelectionHead(): void {
    const head = this.selection()?.head;
    if (!head) {
      return;
    }
    const colId = this.selectableColumns()[head.col];
    if (colId) {
      this.api?.setFocusedCell(head.row, colId);
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
   * What Copy or Cut last put on the *row* clipboard — separate from the
   * system clipboard {@link onCopy}/{@link onPaste} read and write, since a
   * line carries structured data (a name, an amount, a share per person) a
   * plain TSV cell block has no room for. In-memory only, the same as
   * {@link selection} — nothing here is meant to survive a reload or reach
   * another tab.
   */
  private readonly rowClipboard = signal<RowClipboardEntry[]>([]);

  /**
   * Lines a Cut has marked to go, but not yet removed — rather than
   * deleting on the spot: a Paste that never happens should not have cost
   * the line, and Escape ({@link cancelPendingCut}) is what backs out of
   * it. Drawn on the line's own number, not the whole line — a light gray
   * bar, via the `index` column's own `cellClassRules` in {@link columns} —
   * and {@link refreshMarkerCells} is what makes AG Grid actually ask that
   * rule again after this changes, the same as any other `cellClassRules`
   * entry needs. Empty means "nothing pending", including for a plain Copy.
   */
  private readonly cutPending = signal<{ sheetId: string; itemId: string }[]>([]);

  /**
   * Lines a Copy last put on the row clipboard — drawn the same way as
   * {@link cutPending}, a bar on the line's own number, in green instead of
   * gray so the two read as different things at a glance. Cleared by
   * {@link clearCopiedMark}: a fresh Copy or Cut, or Escape — never by a
   * Paste, since a Copy is repeatable and stays valid after landing once.
   */
  private readonly copiedRows = signal<{ sheetId: string; itemId: string }[]>([]);

  /**
   * Clamps a dropdown's `{x, y}` anchor to stay fully inside the viewport.
   * `addMenuAnchor`, `shareMenuAnchor`, `exportMenuAnchor` and
   * `reorderMenuAnchor` all anchor from their button's own *left* edge, so a
   * button sitting close to the right side of the toolbar — or, worse,
   * inside the right-hugging overflow menu itself — can otherwise open a
   * dropdown that runs off the right edge of the viewport, invisible past
   * the browser's own edge. `overflowMenuAnchor` doesn't need this: it's
   * deliberately anchored from the *right* instead (see the comment on it,
   * below), which can't run off the edge it's already measuring from.
   * `width`/`height` match `.toolbar-menu`'s own `min-width` and the taller
   * of its two-button dropdowns (Export/Reorder's icon rows) in the styles
   * below — these are two-item menus only, never taller.
   */
  private clampMenuAnchor(rect: DOMRect): { x: number; y: number } {
    const width = 150;
    const height = 100;
    const margin = 8;
    return {
      x: Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin)),
      y: Math.max(margin, Math.min(rect.bottom + 4, window.innerHeight - height - margin)),
    };
  }

  /**
   * Where the Add dropdown (Add Sheet / Add Person) is open, in viewport
   * coordinates — anchored under the toolbar button that opened it, the
   * same pattern as {@link shareMenuAnchor} just below.
   */
  protected readonly addMenuAnchor = signal<{ x: number; y: number } | null>(null);

  /** Opens the Add dropdown under the button that was clicked, or closes it if already open. */
  protected toggleAddMenu(event: MouseEvent): void {
    if (this.addMenuAnchor()) {
      this.closeAddMenu();
      return;
    }
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.addMenuAnchor.set(this.clampMenuAnchor(rect));
  }

  protected closeAddMenu(): void {
    this.addMenuAnchor.set(null);
  }

  /**
   * Where the Shares dropdown (Everyone / Clear shares) is open, in viewport
   * coordinates — anchored under the toolbar button that opened it, the same
   * way the old right-click menu was anchored under the pointer, before it
   * moved to the toolbar entirely.
   */
  protected readonly shareMenuAnchor = signal<{ x: number; y: number } | null>(null);

  /** Opens the Shares dropdown under the button that was clicked, or closes it if already open. */
  protected toggleShareMenu(event: MouseEvent): void {
    if (this.shareMenuAnchor()) {
      this.closeShareMenu();
      return;
    }
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.shareMenuAnchor.set(this.clampMenuAnchor(rect));
  }

  protected closeShareMenu(): void {
    this.shareMenuAnchor.set(null);
  }

  /**
   * Where the Export dropdown (Save as JSON / Save as PNG) is open, in
   * viewport coordinates — anchored under the toolbar button that opened it,
   * the same pattern as {@link addMenuAnchor} and {@link shareMenuAnchor}.
   * The two save formats share one toolbar slot rather than each keeping
   * their own button: both are "export the split," and the toolbar is
   * measured space (see the container-query breakpoints below) that a
   * second one-off button would cost permanently for something reached for
   * only occasionally.
   */
  protected readonly exportMenuAnchor = signal<{ x: number; y: number } | null>(null);

  /** Opens the Export dropdown under the button that was clicked, or closes it if already open. */
  protected toggleExportMenu(event: MouseEvent): void {
    if (this.exportMenuAnchor()) {
      this.closeExportMenu();
      return;
    }
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.exportMenuAnchor.set(this.clampMenuAnchor(rect));
  }

  protected closeExportMenu(): void {
    this.exportMenuAnchor.set(null);
  }

  /**
   * Where the Reorder dropdown (Sheets / People) is open, the same pattern
   * as {@link exportMenuAnchor}. Sheets and people share one toolbar slot
   * rather than each keeping their own reorder button, both for the same
   * reason Export shares one slot for its two formats — this is reached for
   * occasionally, not on every visit.
   */
  protected readonly reorderMenuAnchor = signal<{ x: number; y: number } | null>(null);

  /** Opens the Reorder dropdown under the button that was clicked, or closes it if already open. */
  protected toggleReorderMenu(event: MouseEvent): void {
    if (this.reorderMenuAnchor()) {
      this.closeReorderMenu();
      return;
    }
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.reorderMenuAnchor.set(this.clampMenuAnchor(rect));
  }

  protected closeReorderMenu(): void {
    this.reorderMenuAnchor.set(null);
  }

  /**
   * Where the overflow menu is open, right-aligned under the "More actions"
   * button: unlike {@link shareMenuAnchor}, that button sits at the
   * toolbar's own right edge, so a menu grown from its *left* edge risks
   * running off the right side of the viewport instead.
   */
  protected readonly overflowMenuAnchor = signal<{ right: number; top: number } | null>(null);

  /**
   * The one real box in each `.toolbar-cluster` — the divider survives its
   * wrapper's `display: contents`, everything else in there does not — in
   * DOM order, so index 0 is group 1 (Delete/Shares) through index 3, group
   * 4 (Reorder/Export). What {@link toggleOverflowMenu} checks to
   * tell which groups the container query below has actually collapsed.
   */
  private readonly clusterMarkers = viewChildren<ElementRef<HTMLElement>>('cluster');

  /**
   * Which of the four toolbar groups (1-based, matching `.cluster-1`
   * through `.cluster-4`) are currently collapsed — computed once, when the
   * menu opens, rather than kept continuously in sync: nothing changes it
   * while the menu is open except a resize, and closing on resize (like the
   * Shares dropdown already implicitly does, since its own anchor is a
   * snapshot too) is a fair trade against watching every group with a
   * `ResizeObserver` for a popup that is rarely open in the first place.
   */
  protected readonly overflowedClusters = signal<ReadonlySet<number>>(new Set());

  /** Opens the overflow menu under the "More actions" button, or closes it if already open. */
  protected toggleOverflowMenu(event: MouseEvent): void {
    if (this.overflowMenuAnchor()) {
      this.closeOverflowMenu();
      return;
    }
    const hidden = new Set<number>();
    this.clusterMarkers().forEach((marker, index) => {
      if (marker.nativeElement.offsetParent === null) {
        hidden.add(index + 1);
      }
    });
    this.overflowedClusters.set(hidden);
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.overflowMenuAnchor.set({ right: window.innerWidth - rect.right, top: rect.bottom + 4 });
  }

  protected closeOverflowMenu(): void {
    this.overflowMenuAnchor.set(null);
  }

  /**
   * Escape's own job: close the Add, Shares, Export and Reorder dropdowns
   * and the overflow menu, back out of a pending cut, and dismiss a Copy's
   * own marching-ants marker.
   */
  protected onEscape(): void {
    this.closeAddMenu();
    this.closeShareMenu();
    this.closeExportMenu();
    this.closeReorderMenu();
    this.closeOverflowMenu();
    this.cancelPendingCut();
    this.cancelCopiedMark();
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
   * Snapshots the ticked lines onto the row clipboard and un-ticks them —
   * the same deselect a Cut does, so the tick reads as "acted on" rather
   * than sitting there afterward as if nothing had happened. Marked with a
   * dashed outline ({@link getRowClass}) in their place, Excel's own
   * marching-ants convention for "this is what a Paste will place" — not
   * the Cut's own dimming, since nothing here is about to be removed, and
   * left marked after a Paste rather than cleared by it, since a Copy is
   * repeatable and there is no single moment it stops applying.
   */
  protected copyTickedRows(): void {
    if (!this.ticked().length) {
      return;
    }
    this.rowClipboard.set(this.snapshotTicked());
    // A fresh Copy replaces whatever a previous, still-unpasted Cut left
    // pending — those lines were never actually removed, so all this does
    // is give them their normal look back.
    this.clearCutPending();
    this.clearCopiedMark();
    const copied = this.tickedItems();
    this.copiedRows.set(copied);
    this.api?.deselectAll();
    this.refreshMarkerCells(copied);
  }

  /**
   * Marks the ticked lines to go, the way Explorer's own Cut does: dimmed
   * ({@link getRowClass}) and still fully there — untouched by Undo/Redo,
   * since nothing has changed in the trip yet — until a {@link pasteRows}
   * actually moves them, or {@link cancelPendingCut} (Escape) calls it off.
   * Un-ticked once marked, since the dimming is now what shows they are
   * spoken for, not the tick.
   */
  protected cutTickedRows(): void {
    if (!this.ticked().length) {
      return;
    }
    this.clearCutPending();
    this.clearCopiedMark();
    this.rowClipboard.set(this.snapshotTicked());
    const pending = this.tickedItems();
    this.cutPending.set(pending);
    this.api?.deselectAll();
    this.refreshMarkerCells(pending);
  }

  /**
   * Backs a pending Cut out — Escape's own job (see {@link onEscape}) —
   * restoring the dimmed lines and clearing the clipboard along with them:
   * unlike a plain Copy, a Cut has nothing worth keeping around once it is
   * called off, since the lines it would have moved are right there,
   * unchanged. A no-op with nothing pending, so Escape elsewhere keeps doing
   * only its other job of closing the Shares dropdown.
   */
  protected cancelPendingCut(): void {
    const pending = this.cutPending();
    if (!pending.length) {
      return;
    }
    this.cutPending.set([]);
    this.rowClipboard.set([]);
    this.refreshMarkerCells(pending);
  }

  private clearCutPending(): void {
    const pending = this.cutPending();
    if (pending.length) {
      this.cutPending.set([]);
      this.refreshMarkerCells(pending);
    }
  }

  /**
   * Backs a Copy out entirely — Escape's own job (see {@link onEscape}),
   * the same full cancel a pending Cut gets from {@link cancelPendingCut}:
   * clears the marching-ants mark *and* the clipboard it points to, so a
   * Paste right after has nothing to place. A no-op with nothing marked, so
   * Escape elsewhere keeps doing only its other jobs.
   */
  protected cancelCopiedMark(): void {
    const marked = this.copiedRows();
    if (!marked.length) {
      return;
    }
    this.copiedRows.set([]);
    this.rowClipboard.set([]);
    this.refreshMarkerCells(marked);
  }

  /**
   * As {@link clearCutPending}: clears just the mark, for a new Copy or Cut
   * superseding it rather than backing it out — the clipboard is about to
   * be overwritten by the caller regardless, so there is nothing to save
   * here the way {@link cancelCopiedMark} has to.
   */
  private clearCopiedMark(): void {
    const marked = this.copiedRows();
    if (marked.length) {
      this.copiedRows.set([]);
      this.refreshMarkerCells(marked);
    }
  }

  /**
   * Forces the line-number column's own `cellClassRules` — the Cut and
   * Copy markers, see {@link columns} — to be asked again for exactly
   * these lines. `refreshCells` is what re-runs a `cellClassRules` entry;
   * see {@link cutPending}'s own doc comment for why it has to be asked at
   * all.
   */
  private refreshMarkerCells(lines: readonly { itemId: string }[]): void {
    const api = this.api;
    if (!api) {
      return;
    }
    const nodes = lines
      .map((line) => api.getRowNode(`item:${line.itemId}`))
      .filter((node): node is IRowNode<LedgerRowData> => !!node);
    if (nodes.length) {
      api.refreshCells({ rowNodes: nodes, columns: ['index'], force: true });
    }
  }

  /**
   * Inserts the row clipboard's lines, in order, right after {@link
   * pasteAnchor} — into whichever sheet that anchor is in, which may not be
   * the sheet they were copied from: shares live at trip level (see {@link
   * RowClipboardEntry}), so a person's share carries over even across a
   * sheet boundary.
   *
   * A Cut's own source lines are removed in the same {@link
   * TripStore.transaction transaction} as the insert, so the whole move is
   * one undo step — and the clipboard is emptied afterward, since a Cut only
   * ever lands once (see {@link cutPending}). A plain Copy leaves the
   * clipboard alone, the way a spreadsheet's own repeatable paste does.
   */
  protected pasteRows(): void {
    const clip = this.rowClipboard();
    const anchor = this.pasteAnchor();
    if (!clip.length || !anchor) {
      return;
    }
    const pending = this.cutPending();
    this.store.transaction(() => {
      let at = anchor.index + 1;
      for (const entry of clip) {
        const item = this.store.insertItem(anchor.sheetId, at, entry.name, entry.amount);
        for (const [personId, share] of Object.entries(entry.shares)) {
          this.store.setShare(item.id, personId, share);
        }
        at += 1;
      }
      for (const line of pending) {
        this.store.removeItem(line.sheetId, line.itemId);
      }
    });
    if (pending.length) {
      this.rowClipboard.set([]);
      this.cutPending.set([]);
    }
  }

  /** Whether {@link pasteRows} has both something to paste and somewhere to put it. */
  protected canPasteRows(): boolean {
    return this.rowClipboard().length > 0 && this.pasteAnchor() !== null;
  }

  /**
   * The ticked lines' data, read once before any of them is written to — the
   * same reasoning as {@link tickedItems}, extended to the whole line rather
   * than just its id.
   */
  private snapshotTicked(): RowClipboardEntry[] {
    const shares = this.store.trip().shares;
    return this.ticked().map((line) => ({
      name: line.row.item.name,
      amount: line.row.item.amount,
      shares: { ...shares[line.row.item.id] },
    }));
  }

  /**
   * Where a row paste lands: right after the last ticked line if any are
   * ticked; otherwise the line under the current cell selection's own
   * bottom row; otherwise — the only way to target a sheet with no lines
   * at all, which has no line to select a cell on — the sheet whose
   * add-item row was last clicked (see {@link addRowFocus}), landing at its
   * end. Null when none of the three resolves to a real sheet, which leaves
   * {@link pasteRows} nothing to do.
   */
  private pasteAnchor(): { sheetId: string; index: number } | null {
    const ticked = this.ticked();
    if (ticked.length) {
      const last = ticked[ticked.length - 1];
      return this.itemAnchor(last.sheetId, last.row.item.id);
    }
    const range = this.selection();
    const node = this.api && range && this.api.getDisplayedRowAtIndex(rangeBounds(range).bottom);
    if (node?.data?.kind === 'item') {
      return this.itemAnchor(node.data.sheetId, node.data.row.item.id);
    }
    const addRow = this.addRowFocus();
    if (!addRow) {
      return null;
    }
    const items = this.store.sheets().find((sheet) => sheet.id === addRow.sheetId)?.items ?? [];
    return { sheetId: addRow.sheetId, index: items.length - 1 };
  }

  /** A line's live position within its own sheet's items — not its ledger display index, which may number continuously across sheets. */
  private itemAnchor(sheetId: string, itemId: string): { sheetId: string; index: number } | null {
    const items = this.store.sheets().find((sheet) => sheet.id === sheetId)?.items ?? [];
    const index = items.findIndex((item) => item.id === itemId);
    return index < 0 ? null : { sheetId, index };
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
   * The filler beneath a short block is padding, not a line, and the
   * add-item row — Item and Amount included, not just the merged, hatched
   * block of person columns beside them — is not one *yet*: nothing on
   * either is a value to copy from, paste into, drag a block across, or
   * paint a ring around. A click on either behaves like a click on nothing
   * — {@link onCellMouseDown} falls back to clearing the selection outright
   * for a `null` ref — rather than like a click that happens to land on an
   * empty cell. This is also what keeps a block spanning past the add-item
   * row into a later sheet (see {@link onCellKeyDown}'s own `skipAddItemRow`)
   * from painting a ring over it on the way through: {@link isSelected}
   * reads this for the row in between too, and a `null` ref here is what
   * makes it say no regardless of whether that row's own index happens to
   * fall inside the range's rectangle.
   */
  private cellRef(node: IRowNode<LedgerRowData>, colId: string): CellRef | null {
    if (node.data?.kind === 'filler' || node.data?.kind === 'add-item') {
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
    if (range) {
      this.addRowFocus.set(null);
    }
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
    if (isTyping(event.target)) {
      return;
    }
    // Ticked lines take priority over a cell block: the two selections can
    // coexist (ticking a line does not clear a cell range, or vice versa),
    // and a line is the coarser, more deliberate choice of the two.
    if (this.ticked().length) {
      this.copyTickedRows();
      event.preventDefault();
      return;
    }
    const api = this.api;
    const range = this.selection();
    if (!api || !range) {
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
   * Cut has no cell-level meaning of its own — a plain cell block already has
   * Delete for "clear the values", and there is nothing beyond that for Cut
   * to add — so this only ever acts on ticked lines, the same as {@link
   * onCopy}'s own priority branch.
   */
  protected onCut(event: ClipboardEvent): void {
    if (isTyping(event.target) || !this.ticked().length) {
      return;
    }
    event.preventDefault();
    this.cutTickedRows();
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
    if (isTyping(event.target)) {
      return;
    }
    // As {@link onCopy}: ticked lines take priority. Gated on a tick, not
    // merely on {@link rowClipboard} holding something, so a stale row
    // clipboard from an earlier copy never hijacks an ordinary cell paste —
    // the tick is what says "I mean lines" for this keystroke.
    if (this.ticked().length) {
      event.preventDefault();
      this.pasteRows();
      return;
    }
    const api = this.api;
    const range = this.selection();
    const text = event.clipboardData?.getData('text/plain');
    if (!api || !range || !text) {
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
    // Every column is fixed — Sheet, the tick box and the line number are
    // what the ledger is grouped and read by, Item/Amount are the two
    // everything else lines up under, and a person's own order comes from
    // the "Reorder → People" toolbar dialog rather than a header drag.
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
    buildLedgerRows(
      this.store.split().rows,
      this.store.sheets(),
      this.settings.continuousRowNumbers(),
    ),
  );

  /**
   * {@link rows}, minus every sheet's own add-item row — what {@link savePng}
   * swaps in as the grid's `rowData` for as long as {@link capturing} is
   * true. Filtered rather than hidden with CSS: an add-item row is sized and
   * spanned as part of its sheet's block (see `sheet-cell.ts`'s height
   * `effect()`), so hiding its DOM would leave a blank gap rather than a
   * closed-up one — AG Grid positions rows by absolute offset, not CSS flow.
   */
  protected readonly printRows = computed<LedgerRowData[]>(() =>
    this.rows().filter((row) => row.kind !== 'add-item'),
  );

  /**
   * The totals band is plain HTML, not a grid row, so its columns have to be
   * told to match the real ones by hand rather than inheriting them. Every
   * width here is copied from {@link columns} — Sheet's 50, the line number's
   * 30, Amount's 80, 30 for every person, and {@link ADD_PERSON_COLUMN_WIDTH}
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
   *
   * Both trailing tracks are dropped while {@link capturing}: the add-person
   * column itself is gone from the grid then (see {@link printColumns}), and
   * the scrollbar spacer has nothing left to reserve room for — a capture
   * has no scrollbar of its own to line up with. Left in, either would
   * widen the band past the now-narrower grid, and `.report`'s own
   * `max-content` (`:host(.exporting-png)`, below) would pick the band's
   * wider, wrong number over the grid's real one — the same failure mode
   * {@link shrinkItemColumnToContent}'s own doc comment already covers for
   * Item.
   */
  protected readonly totalsColumns = computed(() => {
    // Not `repeat(N, 30px)`: with nobody in the split yet, N is 0, and
    // `repeat()` treats a zero count as invalid — which invalidates the
    // whole `grid-template-columns` declaration, not just that term, and
    // the band collapses to an unstyled implicit grid.
    const peopleTracks = Array(this.store.people().length).fill('30px').join(' ');
    const itemWidth = this.itemColumnWidth();
    const itemTrack = itemWidth != null ? `${itemWidth}px` : 'minmax(150px, 1fr)';
    return [
      '50px',
      '30px',
      itemTrack,
      '80px',
      peopleTracks,
      ...(this.capturing() ? [] : [`${ADD_PERSON_COLUMN_WIDTH}px`, `${GRID_SCROLLBAR_WIDTH}px`]),
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
        width: 50,
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
        // Opened by its own click handler, not by typing over a value — Tab
        // and the arrow keys skip it the same way they skip the index column
        // beside it, rather than stopping on a cell with nothing to read.
        suppressNavigable: true,
        cellRendererParams: {
          openEditor: (sheetId: string) => this.editingSheetId.set(sheetId),
          // So the merged Sheet-name box can size itself off the add-item
          // row's *actual* current height instead of assuming every row in
          // the block is `LEDGER_ROW_HEIGHT` — see `sheet-cell.ts`'s height
          // `effect()`.
          isAddRowEditing: (sheetId: string) => this.editingAddRowId() === `add-item:${sheetId}`,
          isCapturing: () => this.capturing(),
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
          'ledger-cut-pending': (p) =>
            p.data?.kind === 'item' && this.isCutPending(p.data.row.item.id),
          'ledger-copied': (p) => p.data?.kind === 'item' && this.isCopied(p.data.row.item.id),
        },
        // A click here ticks the line rather than landing on a value to
        // read or navigate into (`onCellMouseDown`, `onCellFocused`), so
        // Tab and the arrow keys skip the column outright on every row, not
        // just the add-item and filler rows a colDef's own `suppressNavigable`
        // used to single out — that pair only mattered back when a real
        // item row's own index cell was still a stopping point.
        suppressNavigable: true,
        valueGetter: (p: ValueGetterParams<LedgerRowData>) =>
          p.data?.kind === 'item' ? p.data.index : '',
      },
      {
        colId: 'item',
        headerName: 'Item',
        headerClass: 'ledger-item-header',
        flex: 1,
        minWidth: 150,
        cellClass: 'ledger-item',
        editable: (p) => p.data?.kind === 'item' || p.data?.kind === 'add-item',
        // The name doubles as the drag handle — the number column beside it
        // is only 30px, too narrow for the handle icon to sit next to the
        // number without crowding it out. See {@link SplitGrid.onRowDragEnd}
        // for where the drop lands.
        rowDrag: ((p) => p.data?.kind === 'item') satisfies RowDragCallback<LedgerRowData>,
        rowDragText: (p) => {
          const data = p.rowNode?.data as LedgerRowData | undefined;
          return data?.kind === 'item' ? data.row.item.name || 'Untitled item' : p.defaultTextValue;
        },
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
        width: 80,
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
        width: 30,
        // AG Grid's own default `minWidth` is `min(36, rowHeight)` — wider
        // than this column, and left alone it wins over `width` above (see
        // {@link ADD_PERSON_COLUMN_WIDTH}'s doc comment for the same fix on
        // the trailing add-person column).
        minWidth: 30,
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
        cellEditor: ShareCellEditor,
        valueGetter: (p: ValueGetterParams<LedgerRowData>) =>
          p.data?.kind === 'item'
            ? packShare(this.store.share(p.data.row.item.id, person.id))
            : null,
        // A share is a ratio, not an amount — putting a currency symbol on it
        // would be a lie about what it means. Shown as `owe|pay` rather than
        // the packed `owe.pay` decimal underneath: `0|1` cannot be misread as
        // a fraction the way `0.1` can.
        valueFormatter: (p) => (p.value == null ? '' : formatShare(unpackShare(p.value))),
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

  /**
   * {@link columns}, minus the trailing add-person column — what {@link
   * savePng} swaps in as the grid's `columnDefs` for as long as {@link
   * capturing} is true, the same reasoning as {@link printRows} for the
   * add-item row. Unlike the add-sheet/add-person "+" buttons' own icons
   * (`app-add-sheet-header`, hidden with plain CSS in the
   * `:host(.exporting-png)` styles below — the Sheet column itself stays,
   * so only its button needs hiding), the add-person column holds nothing
   * *but* its own button: dropping the whole column from the capture, not
   * just the icon inside it, is what keeps a PNG from ending in a blank
   * navy sliver nobody's balance or name ever occupied. `totalsColumns` and
   * `totalColumnWidth`/`captureGridWidth` both follow it automatically —
   * the former reads {@link capturing} directly to drop its own matching
   * track, the latter two just sum whatever `columnDefs` the grid actually
   * has at the time.
   */
  protected readonly printColumns = computed<ColDef<LedgerRowData>[]>(() =>
    this.columns().filter((column) => column.colId !== 'add-person'),
  );

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
   * Matched by item id alone, not sheet — ids only need to be unique within
   * a trip (see `trip-store.ts`'s `nextId`), and that is already enough
   * here. Same for {@link isCopied}, below. Both back the line-number
   * column's own \`cellClassRules\` — see {@link columns} — not {@link
   * getRowClass}: the marker belongs on the line's own number, not the
   * whole line.
   */
  private isCutPending(itemId: string): boolean {
    return this.cutPending().some((line) => line.itemId === itemId);
  }

  private isCopied(itemId: string): boolean {
    return this.copiedRows().some((line) => line.itemId === itemId);
  }

  // Keeps a dragged line inside its own sheet's block: the "add" and filler
  // rows below it aren't valid targets either, so the furthest a line can
  // travel is just above or below another line of the same sheet.
  protected readonly isRowValidDropPosition = ((params) =>
    params.overNode?.data?.kind === 'item' &&
    params.overNode.data.sheetId ===
      params.source.data?.sheetId) satisfies IsRowValidDropPositionCallback<LedgerRowData>;

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
 * `owe|pay` — but a part that is 0, meaning that side of the ratio was never
 * set, is left out rather than spelled out: an owe-only share reads `1`, a
 * pay-only one `|1`. Only a share with both parts set reads `2|1`.
 */
function formatShare(share: Share): string {
  if (share.owe && share.pay) {
    return `${share.owe}|${share.pay}`;
  }
  if (share.pay) {
    return `|${share.pay}`;
  }
  return `${share.owe}`;
}

/**
 * Parses a share cell. Accepts the display format, `owe|pay`, each an
 * integer within the workbook's own bounds (owe 0 – 10, pay a single digit
 * 0 – 9); and, for typing muscle memory carried over from the original
 * spreadsheet, the packed `owe.pay` decimal that format is short for.
 * Returns null for anything outside either.
 */
function parseShare(value: unknown): Share | null {
  const raw = String(value ?? '').trim();
  if (raw === '') {
    return { owe: 0, pay: 0 };
  }
  if (raw.includes('|')) {
    const [owePart, payPart = '0'] = raw.split('|');
    const owe = Number(owePart);
    const pay = Number(payPart);
    if (!Number.isInteger(owe) || owe < 0 || owe > 10 || !Number.isInteger(pay) || pay < 0 || pay > 9) {
      return null;
    }
    return { owe, pay };
  }
  const packed = Number(raw);
  if (!Number.isFinite(packed) || packed < 0 || packed > 10) {
    return null;
  }
  return unpackShare(packed);
}
