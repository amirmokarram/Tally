import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { TripStore } from '../core/trip-store';
import { MoneyPipe } from '../core/money.pipe';
import { SplitRow } from '../core/split-engine';
import { packShare, unpackShare } from '../models/trip.model';

interface RowGroup {
  sheetId: string;
  sheetName: string;
  rows: SplitRow[];
  /** Small "Tx: … – Tp: …" caption the spreadsheet printed down the left edge. */
  caption: string;
}

/**
 * The Split sheet — every item from every expense sheet in one grid, with a
 * column per person.
 *
 * A cell holds the workbook's packed `owe.pay` number: the whole part is how
 * much of the item that person is on the hook for *relative to the others in
 * the same row*, and the first decimal is how much of it they already paid.
 * `1.2` therefore reads "owes one share, paid two".
 */
@Component({
  selector: 'app-split-grid',
  imports: [MoneyPipe],
  templateUrl: './split-grid.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
    }

    .legend {
      display: flex;
      flex-wrap: wrap;
      gap: 18px;
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

    .scroller {
      overflow-x: auto;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--surface);
    }

    table {
      border-collapse: collapse;
      width: 100%;
      min-width: 640px;
    }

    th,
    td {
      border-bottom: 1px solid var(--border);
      padding: 6px 10px;
      text-align: left;
    }

    thead th {
      background: var(--navy-800);
      color: var(--text-invert);
      font-size: 13px;
      font-weight: 600;
      position: sticky;
      top: 0;
      z-index: 1;
    }

    .balance-row th {
      background: var(--navy-050);
      color: var(--text);
      border-bottom: 2px solid var(--border-strong);
      font-size: 15px;
      text-align: right;
      position: static;
    }

    .balance-row .balance-label {
      text-align: left;
      font-weight: 550;
      color: var(--text-muted);
      font-size: 13px;
    }

    .person-col {
      width: 78px;
      text-align: center !important;
    }

    .amount-col {
      width: 130px;
      text-align: right !important;
    }

    .sheet-col {
      width: 150px;
      color: var(--text-muted);
    }

    tbody tr:nth-child(odd) td {
      background: var(--surface-alt);
    }

    .sheet-cell {
      font-weight: 600;
      color: var(--navy-800);
      vertical-align: top;
      border-right: 1px solid var(--border);
    }

    .sheet-caption {
      display: block;
      font-weight: 400;
      font-size: 11px;
      color: var(--text-muted);
      margin-top: 2px;
    }

    .amount {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }

    .share-cell {
      padding: 3px 4px;
      text-align: center;

      &.paid {
        background: var(--paid-bg) !important;
      }

      &.missing {
        background: var(--credit-bg) !important;
      }
    }

    .share-input {
      width: 62px;
      padding: 4px 2px;
      border: 1px solid transparent;
      border-radius: 4px;
      background: transparent;
      text-align: center;
      font-variant-numeric: tabular-nums;
      font-weight: 600;

      &:hover {
        border-color: var(--border-strong);
      }

      &:focus {
        outline: 2px solid var(--navy-700);
        outline-offset: -1px;
        background: var(--surface);
      }
    }

    .sheet-payer {
      font-size: 11px;
      color: var(--text-muted);
    }

    .row-tools {
      width: 96px;
      white-space: nowrap;
    }

    /* Only the card layout needs it; a column already says whose it is. */
    .person-name {
      display: none;
    }

    .group-dot {
      display: inline-block;
      width: 9px;
      height: 9px;
      border-radius: 50%;
      margin-right: 5px;
      vertical-align: middle;
    }

    .empty {
      padding: 34px 16px;
      text-align: center;
      color: var(--text-muted);
    }

    /* --- Phones ---------------------------------------------------------
       A column per person cannot survive a phone: three people already make
       the grid wider than the screen, and sideways-scrolling a table you have
       to type into is miserable. The same markup is re-laid out below the
       breakpoint — one card per expense sheet, one block per item, and each
       person's box labelled by name instead of by column position.

       The share inputs keep their own aria-labels ("Sarah share of Pizza"),
       so the labels the boxes grow here are decoration rather than the
       accessible name, and nothing is lost when the columns go. */
    @media (max-width: 640px) {
      .legend {
        gap: 4px 14px;
      }

      /* The cards carry their own edges, so the frame around the table goes. */
      .scroller {
        overflow-x: visible;
        border: none;
        background: transparent;
      }

      table,
      thead,
      tbody,
      tr,
      th,
      td {
        display: block;
      }

      table {
        min-width: 0;
      }

      td {
        padding: 0;
        border-bottom: none;
      }

      /* Column widths are meaningless once the cells are blocks, and leave
         gaps in the grid if they survive. */
      .sheet-col,
      .amount-col,
      .person-col,
      .row-tools {
        width: auto;
      }

      /* The column headers are exactly what the per-person labels replace,
         and the two spacer cells have nothing to say in a card. */
      thead tr:not(.balance-row),
      .balance-row th:empty {
        display: none;
      }

      thead,
      tbody {
        margin-bottom: 12px;
        border: 1px solid var(--border);
        border-radius: var(--radius);
        background: var(--surface);
        /* Keeps the sheet strip and the chip hairlines inside the corners. */
        overflow: hidden;
      }

      /* Balances first: the answer to "what do I owe" leads the screen.
         Flex rather than a grid so an odd last person stretches across the
         line instead of leaving a hole — and the gaps are the hairlines, with
         the row's own background showing through them. */
      .balance-row {
        display: flex;
        flex-wrap: wrap;
        gap: 1px;
        background: var(--border);
      }

      .balance-row th {
        flex: 1 1 calc(50% - 1px);
        position: static;
        padding: 8px 11px;
        background: var(--navy-050);
        border-bottom: none;
      }

      .balance-row .person-col {
        background: var(--surface);
        text-align: left !important;
      }

      .person-name {
        display: block;
        font-size: 11px;
        font-weight: 550;
        color: var(--text-muted);
      }

      .balance-amount {
        font-variant-numeric: tabular-nums;
      }

      .credit .person-name {
        color: inherit;
      }

      tbody tr {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
        padding: 10px 12px;
      }

      tbody tr + tr {
        border-top: 1px solid var(--border);
      }

      /* Banding distinguished one row of a wide grid from the next; a card
         needs no help. */
      tbody tr:nth-child(odd) td {
        background: none;
      }

      /* The sheet name titles the card rather than filling a left column. */
      .sheet-cell {
        grid-column: 1 / -1;
        margin: -10px -12px 0;
        padding: 8px 12px;
        border-right: none;
        background: var(--navy-050);
        font-size: 13px;
      }

      .item-cell {
        grid-column: 1;
        align-self: center;
        font-weight: 600;
      }

      .amount {
        grid-column: 2;
        align-self: center;
      }

      .share-cell {
        padding: 5px 8px;
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
        text-align: left;

        &::before {
          content: attr(data-person);
          display: block;
          font-size: 11px;
          color: var(--text-muted);
        }
      }

      .share-input {
        width: 100%;
        padding: 2px 0;
        text-align: left;
        /* Under 16px, iOS zooms the page in on focus and stays there. */
        font-size: 16px;
      }

      .row-tools {
        grid-column: 1 / -1;
        display: flex;
        justify-content: flex-end;
        gap: 6px;
        width: auto;
      }
    }
  `,
})
export class SplitGrid {
  protected readonly store = inject(TripStore);

  /** Rows bucketed by expense sheet, so the sheet name spans its own block. */
  protected readonly groups = computed<RowGroup[]>(() => {
    const rows = this.store.split().rows;
    const totals = this.store.split().sheetTotals;
    const out: RowGroup[] = [];

    for (const row of rows) {
      let group = out.at(-1);
      if (!group || group.sheetId !== row.sheetId) {
        const sheetTotals = totals.get(row.sheetId);
        const parts: string[] = [];
        if (sheetTotals?.tax) {
          parts.push(`Tax ${sheetTotals.tax.toFixed(2)}`);
        }
        if (sheetTotals?.tip) {
          parts.push(`Tip ${sheetTotals.tip.toFixed(2)}`);
        }
        if (sheetTotals?.discount) {
          parts.push(`Disc ${sheetTotals.discount.toFixed(2)}`);
        }
        group = {
          sheetId: row.sheetId,
          sheetName: row.sheetName,
          rows: [],
          caption: parts.join(' · '),
        };
        out.push(group);
      }
      group.rows.push(row);
    }

    return out;
  });

  protected readonly hasRows = computed(() => this.store.split().rows.length > 0);

  protected shareText(itemId: string, personId: string): string {
    const packed = packShare(this.store.share(itemId, personId));
    return packed === null ? '' : String(packed);
  }

  protected onShare(itemId: string, personId: string, event: Event): void {
    const input = event.target as HTMLInputElement;
    const raw = input.value.trim();

    if (raw === '') {
      this.store.setShare(itemId, personId, { owe: 0, pay: 0 });
      return;
    }

    const value = Number(raw);
    // The workbook's data validation on the split grid: 0 – 10, one decimal.
    if (!Number.isFinite(value) || value < 0 || value > 10) {
      input.value = this.shareText(itemId, personId);
      return;
    }
    this.store.setShare(itemId, personId, unpackShare(value));
  }

  protected isPayer(row: SplitRow, personId: string): boolean {
    if (row.usesSheetPayers) {
      return row.sheetPayerIds.includes(personId);
    }
    return this.store.share(row.item.id, personId).pay > 0;
  }

  /** A priced row nobody has claimed a share of — the workbook's red cells. */
  protected isRowUnassigned(row: SplitRow): boolean {
    return row.item.amount != null && row.lineTotal !== 0 && row.unitCost === null;
  }

  protected payerNames(row: SplitRow): string {
    const people = this.store.people();
    return row.sheetPayerIds
      .map((id) => people.find((p) => p.id === id)?.name || 'Unnamed')
      .join(', ');
  }

  protected groupColor(group: number): string {
    return group > 0 ? `var(--group-${((group - 1) % 7) + 1})` : 'transparent';
  }
}
