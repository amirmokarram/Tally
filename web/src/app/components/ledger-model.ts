/**
 * The ledger's row array.
 *
 * AG Grid's own row grouping is an Enterprise feature, so the grouping by
 * expense sheet is done the same way the hand-written table did it: a flat list
 * of rows in sheet order, with the Sheet column spanned across the rows that
 * belong together (`enableCellSpan` + `colDef.spanRows`, both Community).
 *
 * Nothing here imports AG Grid or Angular. Building the array is the only part
 * with decisions in it — which rows exist, in what order, under what id — so it
 * lives apart from the grid that renders it and is tested directly.
 */

import { ExpenseSheet } from '../models/trip.model';
import { SheetTotals, SplitRow } from '../core/split-engine';

/**
 * One line of the ledger.
 *
 * `add-item` is a real row rather than a button parked outside the grid,
 * because the brief is that everything is entered *in* the grid: you add a line
 * by typing on the row under the last one, the way you would in a spreadsheet.
 *
 * Adding a *sheet* is a button below the grid instead. It was a last row here
 * until AG Grid turned out not to render a cell for it in the spanned Sheet
 * column at all — and a control you must scroll past every line of the trip to
 * reach was the worse design anyway.
 */
export type LedgerRow =
  | { kind: 'item'; sheetId: string; row: SplitRow }
  | { kind: 'add-item'; sheetId: string };

/** The pinned top row carrying each person's balance. Never scrolls away. */
export interface BalanceRow {
  kind: 'balances';
}

/** The pinned bottom row carrying the trip total, under the Amount column. */
export interface TotalRow {
  kind: 'total';
}

export type LedgerRowData = LedgerRow | BalanceRow | TotalRow;

/**
 * Rows for the whole trip, in sheet order.
 *
 * Driven by `sheets` rather than by `rows`: a sheet with no items produces no
 * `SplitRow` at all, and walking the split's rows alone would make a newly
 * added sheet invisible — with no way to add the first item to it.
 */
export function buildLedgerRows(
  rows: readonly SplitRow[],
  sheets: readonly ExpenseSheet[],
): LedgerRow[] {
  const bySheet = new Map<string, SplitRow[]>();
  for (const row of rows) {
    const existing = bySheet.get(row.sheetId);
    if (existing) {
      existing.push(row);
    } else {
      bySheet.set(row.sheetId, [row]);
    }
  }

  const out: LedgerRow[] = [];
  for (const sheet of sheets) {
    for (const row of bySheet.get(sheet.id) ?? []) {
      out.push({ kind: 'item', sheetId: sheet.id, row });
    }
    // Inside the sheet's block, so the spanned Sheet cell covers it and the
    // "add" line reads as part of the sheet rather than as a stray row.
    out.push({ kind: 'add-item', sheetId: sheet.id });
  }
  return out;
}

/**
 * Stable identity for a row.
 *
 * This is what lets AG Grid update in place instead of rebuilding: the store
 * hands back a whole new trip object on every keystroke, and without an id the
 * grid would tear down the row being typed into and take the caret with it.
 */
export function ledgerRowId(row: LedgerRowData): string {
  switch (row.kind) {
    case 'item':
      return `item:${row.row.item.id}`;
    case 'add-item':
      return `add-item:${row.sheetId}`;
    case 'balances':
      return 'balances';
    case 'total':
      return 'total';
  }
}

/**
 * The "Tax 5.61 · Tip 12.00" line under a sheet's name — the caption the
 * workbook printed down the left edge of the Split sheet.
 */
export function sheetCaption(totals: SheetTotals | undefined): string {
  if (!totals) {
    return '';
  }
  const parts: string[] = [];
  if (totals.tax) {
    parts.push(`Tax ${totals.tax.toFixed(2)}`);
  }
  if (totals.tip) {
    parts.push(`Tip ${totals.tip.toFixed(2)}`);
  }
  if (totals.discount) {
    parts.push(`Disc ${totals.discount.toFixed(2)}`);
  }
  return parts.join(' · ');
}
