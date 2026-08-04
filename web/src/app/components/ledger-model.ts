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
/** A line of a sheet, numbered within its own block — see {@link buildLedgerRows}. */
export interface LedgerItemRow {
  kind: 'item';
  sheetId: string;
  index: number;
  row: SplitRow;
}

/**
 * A blank row that exists to make a block tall enough to hold its own heading.
 *
 * The Sheet cell is written down the side of the block (`sheet-cell.ts`), so the
 * block's height is the length of the boxes in it — and a sheet with no lines is
 * one row, 37 pixels, which is not a name. A filler row takes it to
 * {@link MIN_BLOCK_ROWS}, where the name, the `⋯` and the three charge boxes
 * all have room.
 *
 * One row rather than one per row of padding needed: there is nothing to
 * distinguish between them, so stacking several identical blanks would only be
 * more of them to build, size and paint. `rows` carries what its own height
 * would otherwise have said — the grid reads it back in `split-grid.ts`'s
 * `getRowHeight` to give this one row the height the padding needs.
 *
 * `rows` is also folded into the row's own id, in {@link ledgerRowId} — see
 * the note there for why a row that only *looks* the same as before is not
 * enough.
 *
 * Nothing can be typed on it: the row above it, the one that ends every block,
 * is where a line is added. It is padding for the heading beside it and nothing
 * else — see {@link MIN_BLOCK_ROWS}.
 */
export interface LedgerFillerRow {
  kind: 'filler';
  sheetId: string;
  /** How many rows of blank space this one stands in for. Always at least 1. */
  rows: number;
}

export type LedgerRow =
  | LedgerItemRow
  | { kind: 'add-item'; sheetId: string }
  | LedgerFillerRow;

/**
 * The shortest a sheet's block may be.
 *
 * Two rows are all the name box and the `⋯` beside it need — 70 pixels of line
 * against the 73 a two-row block gives. Four is for the line beside them: three
 * charge boxes want 154, and a four-row block's 141 brings them to 46 apiece
 * against the 50 they ask for, where a two-row block leaves them 20.
 *
 * It is paid for in blank rows — three on a sheet with no lines, two on a sheet
 * with one, none from three lines on, by which point the block is this tall on
 * its own.
 *
 * Held here rather than in the cell that needs it because it is the *rows* that
 * have to be built, and only this file builds them.
 */
export const MIN_BLOCK_ROWS = 4;

/**
 * The pinned top row: the answer, never scrolled away. Each person's balance
 * under their own column, and the trip total under Amount — the summary sits in
 * one strip directly under the headers rather than at both ends of the grid.
 */
export interface BalanceRow {
  kind: 'balances';
}

export type LedgerRowData = LedgerRow | BalanceRow;

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
    // Numbered from one *within the sheet*, not across the trip: a block is a
    // check, and its lines are that check's lines. The number restarting is
    // what says where one block ends and the next begins.
    let index = 0;
    for (const row of bySheet.get(sheet.id) ?? []) {
      index += 1;
      out.push({ kind: 'item', sheetId: sheet.id, index, row });
    }
    // Inside the sheet's block, so the spanned Sheet cell covers it and the
    // "add" line reads as part of the sheet rather than as a stray row.
    out.push({ kind: 'add-item', sheetId: sheet.id });
    // Padding, under the row that ends the block: a sheet with no lines is
    // otherwise a block too short to write its own name down. One row taken to
    // whatever height the remainder needs, not one row per unit of it.
    const fillerRows = MIN_BLOCK_ROWS - index - 1;
    if (fillerRows > 0) {
      out.push({ kind: 'filler', sheetId: sheet.id, rows: fillerRows });
    }
  }
  return out;
}

/**
 * How many ledger rows a sheet's block occupies: one per item, plus the "add"
 * line {@link buildLedgerRows} closes every block with — and never fewer than
 * {@link MIN_BLOCK_ROWS}, the filler rows making up the difference.
 *
 * Only the spanned Sheet cell needs this — it is sized by row count rather than
 * by content, and AG Grid does not resize it once the block grows.
 */
export function ledgerBlockSize(sheet: ExpenseSheet): number {
  return Math.max(sheet.items.length + 1, MIN_BLOCK_ROWS);
}

/**
 * Stable identity for a row.
 *
 * This is what lets AG Grid update in place instead of rebuilding: the store
 * hands back a whole new trip object on every keystroke, and without an id the
 * grid would tear down the row being typed into and take the caret with it.
 *
 * The filler row is the one place that cuts against its own rule: `rows` rides
 * along in its id instead of being left to change quietly underneath it. AG
 * Grid reads each row's height once, the first time it meets that row's id,
 * and caches the answer against the id — so a filler row updated in place
 * would keep the height it had before the edit, not the height `getRowHeight`
 * would now give it. Changing the id when `rows` does turns that update into a
 * delete and an insert, which is what makes AG Grid ask again.
 */
export function ledgerRowId(row: LedgerRowData): string {
  switch (row.kind) {
    case 'item':
      return `item:${row.row.item.id}`;
    case 'add-item':
      return `add-item:${row.sheetId}`;
    case 'filler':
      return `filler:${row.sheetId}:${row.rows}`;
    case 'balances':
      return 'balances';
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
