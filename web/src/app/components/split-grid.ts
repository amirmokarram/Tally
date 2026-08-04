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
 *   - the last row of a block adds an item; the last row of the grid adds a
 *     sheet.
 *
 * A cell in a person column holds the workbook's packed `owe.pay` number: the
 * whole part is how much of the item that person is on the hook for *relative
 * to the others in the same row*, and the first decimal is how much of it they
 * already paid. `1.2` therefore reads "owes one share, paid two".
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
  ColDef,
  ColumnApiModule,
  GetRowIdParams,
  GridApi,
  GridReadyEvent,
  ModuleRegistry,
  NumberEditorModule,
  PinnedRowModule,
  RowApiModule,
  RowClassParams,
  ScrollApiModule,
  RowStyleModule,
  TextEditorModule,
  ValidationModule,
  ValueGetterParams,
  ValueSetterParams,
} from 'ag-grid-community';

import { TripStore } from '../core/trip-store';
import { MoneyPipe } from '../core/money.pipe';
import { packShare, unpackShare } from '../models/trip.model';
import { LedgerRowData, buildLedgerRows, ledgerRowId } from './ledger-model';
import { ledgerTheme } from './grid-theme';
import { SheetCell } from './sheet-cell';
import { SheetEditor } from './sheet-editor';
import { PersonHeader } from './person-header';
import { RowToolsCell } from './row-tools-cell';

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
  styles: `
    :host {
      display: block;
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

    :host ::ng-deep .ledger-add-row .ag-cell {
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

    :host ::ng-deep .ledger-numeric {
      font-variant-numeric: tabular-nums;
      justify-content: flex-end;
    }

    :host ::ng-deep .ledger-share {
      font-variant-numeric: tabular-nums;
      font-weight: 600;
      justify-content: center;
    }

    :host ::ng-deep .ledger-credit {
      color: var(--credit);
    }

    /* The Sheet cell holds a name, two captions and a hint; it cannot be
       centred on a single text line like every other cell. */
    :host ::ng-deep .ledger-sheet-cell {
      align-items: flex-start;
      line-height: 1.35;
    }
  `,
})
export class SplitGrid {
  private readonly store = inject(TripStore);

  protected readonly theme = ledgerTheme;

  /** The sheet whose settings panel is open, or null. */
  protected readonly editingSheetId = signal<string | null>(null);

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
   */
  protected addPerson(): void {
    const colId = `person:${this.store.addPerson().id}`;
    setTimeout(() => this.api?.ensureColumnVisible(colId));
  }

  protected readonly defaultColDef: ColDef<LedgerRowData> = {
    resizable: true,
    sortable: false,
    filter: false,
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
   * The balance strip, pinned so the answer stays on screen while the rows
   * scroll. Its cells read the store directly, so this only has to produce a
   * fresh array whenever the balances move — otherwise AG Grid, seeing the same
   * reference, leaves the pinned row alone.
   */
  protected readonly pinnedTop = computed<LedgerRowData[]>(() => {
    this.store.balances();
    return [{ kind: 'balances' }];
  });

  /**
   * The trip total, pinned under the Amount column.
   *
   * A fresh array whenever the total moves, for the same reason as
   * {@link pinnedTop}: the cell reads the store, so an unchanged reference
   * would leave the row showing the old figure.
   */
  protected readonly pinnedBottom = computed<LedgerRowData[]>(() => {
    this.store.grandTotal();
    return [{ kind: 'total' }];
  });

  protected readonly columns = computed<ColDef<LedgerRowData>[]>(() => {
    const people = this.store.people();
    const baseSymbol = this.store.baseSymbol();

    const columns: ColDef<LedgerRowData>[] = [
      {
        colId: 'sheet',
        headerName: 'Sheet',
        width: 190,
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
        },
      },
      {
        colId: 'amount',
        headerName: `Amount (${this.sheetCurrencyHeader()})`,
        width: 150,
        type: 'numericColumn',
        editable: (p) => p.data?.kind === 'item' || p.data?.kind === 'add-item',
        valueGetter: (p: ValueGetterParams<LedgerRowData>) => {
          if (p.data?.kind === 'total') {
            return this.store.grandTotal();
          }
          return p.data?.kind === 'item' ? p.data.row.item.amount : null;
        },
        // Only the total is formatted. An amount is a box you type in, and
        // rewriting what was typed while the caret is still in the row is the
        // fastest way to make a grid feel like it is fighting you.
        valueFormatter: (p) =>
          p.data?.kind === 'total' ? money.transform(p.value, baseSymbol) : (p.value ?? ''),
        cellClass: (p) =>
          p.data?.kind === 'total' ? 'ledger-numeric ledger-total' : 'ledger-numeric',
        valueSetter: (p: ValueSetterParams<LedgerRowData>) => {
          const amount = parseAmount(p.newValue);
          return this.setItemField(p, (sheetId, itemId) =>
            this.store.updateItem(sheetId, itemId, { amount }),
          );
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
        width: 96,
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
        valueFormatter: (p) => {
          if (p.data?.kind === 'balances') {
            return money.transform(p.value);
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
        },
      });
    }

    columns.push({
      colId: 'tools',
      headerName: '',
      width: 120,
      editable: false,
      cellRenderer: RowToolsCell,
    });

    return columns;
  });

  protected readonly getRowId = (params: GetRowIdParams<LedgerRowData>): string =>
    ledgerRowId(params.data);

  protected readonly getRowClass = (params: RowClassParams<LedgerRowData>): string =>
    params.data?.kind === 'add-item' ? 'ledger-add-row' : '';

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
