/**
 * The sheet editor: everything about an expense sheet that is not one of its
 * items — name, currency, exchange rate, tax/tip/discount, and who paid. Those
 * settings needed a tab of their own only because there was nowhere in the grid
 * to put them; this is that place, opened from a sheet's cell.
 *
 * It is deliberately *not* an AG Grid cell editor. The Sheet column is spanned
 * across its block of rows, and AG Grid will not let a spanned column be
 * editable — "'spanRows' requires 'editable' to be one of [false, undefined]",
 * and it drops the cell's contents altogether. So the grid owns this panel and
 * renders it over itself, which also sidesteps the clipping a popup inside a
 * cell would run into.
 *
 * Nothing here holds a draft. Every control writes straight to the store, so
 * the numbers behind the panel recalculate as you type — which is the whole
 * point of a tip field.
 */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
} from '@angular/core';

import { DEFAULT_CURRENCY, ExpenseSheet, formatCharge, parseCharge } from '../models/trip.model';
import { TripStore } from '../core/trip-store';
import { round } from '../core/split-engine';
import { CurrencyPicker } from './currency-picker';

type ChargeKind = 'tax' | 'tip' | 'discount';

@Component({
  selector: 'app-sheet-editor',
  imports: [CurrencyPicker],
  templateUrl: './sheet-editor.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
      width: 320px;
      max-height: 70vh;
      overflow-y: auto;
      background: var(--surface);
      border: 1px solid var(--border-strong);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
    }

    .panel {
      padding: 14px 16px;
    }

    h3 {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--text-muted);
      margin: 16px 0 10px;
    }

    .row {
      display: grid;
      grid-template-columns: 110px minmax(0, 1fr);
      align-items: center;
      gap: 10px;
      margin-bottom: 10px;
    }

    .row label {
      font-size: 14px;
      color: var(--text-muted);
    }

    .rate-hint {
      font-size: 12px;
      color: var(--text-muted);
      margin: 6px 0 0;
    }

    .charge-grid {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 8px 10px;
      align-items: center;
    }

    .charge-complement {
      font-size: 12px;
      color: var(--text-muted);
      min-width: 72px;
      text-align: right;
    }

    .payers {
      display: flex;
      flex-direction: column;
      gap: 6px;
      max-height: 180px;
      overflow-y: auto;
    }

    .payer {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 14px;
    }

    .hint {
      font-size: 12px;
      color: var(--text-muted);
      margin: 8px 0 0;
    }

    .footer {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      margin-top: 18px;
      padding-top: 14px;
      border-top: 1px solid var(--border);
    }
  `,
})
export class SheetEditor {
  protected readonly store = inject(TripStore);

  /** Which sheet is being edited. */
  readonly sheetId = input.required<string>();

  /** Asks the grid to take the panel down. */
  readonly closed = output<void>();

  /**
   * Derived, never captured.
   *
   * The store replaces the trip wholesale on every change, so a snapshot taken
   * when the panel opened is stale the moment anything in it is edited — the
   * currency box would go on showing the currency you just replaced. Only the
   * id is held; the sheet itself is read fresh.
   */
  protected readonly sheet = computed<ExpenseSheet | undefined>(() =>
    this.store.sheets().find((s) => s.id === this.sheetId()),
  );

  protected close(): void {
    this.closed.emit();
  }

  // --- Currency ---------------------------------------------------------

  protected usesOwnCurrency(sheet: ExpenseSheet): boolean {
    return sheet.currency !== DEFAULT_CURRENCY;
  }

  protected rateText(sheet: ExpenseSheet): string {
    const rate = this.store.rateFor(sheet);
    return rate ? String(round(rate, 8)) : '';
  }

  protected onRate(sheetId: string, event: Event): void {
    const raw = (event.target as HTMLInputElement).value.trim();
    // Clearing the box reverts to the daily rate, exactly like the workbook.
    this.store.setSheetRate(sheetId, raw === '' ? null : Number(raw));
  }

  protected autoRateText(sheet: ExpenseSheet): string {
    const rate = this.store.autoRateFor(sheet);
    return rate === null ? 'no rate on file' : String(round(rate, 8));
  }

  // --- Tax / tip / discount --------------------------------------------

  protected chargeText(sheet: ExpenseSheet, kind: ChargeKind): string {
    return formatCharge(sheet[kind]);
  }

  protected onCharge(sheetId: string, kind: ChargeKind, event: Event): void {
    const input = event.target as HTMLInputElement;
    const charge = parseCharge(input.value);
    if (charge) {
      input.classList.remove('invalid');
      this.store.setCharge(sheetId, kind, charge);
    } else {
      input.classList.add('invalid');
    }
  }

  /**
   * The spreadsheet showed the *other* form alongside the label — a flat tax
   * displayed its percentage and vice versa — so the number can be sanity
   * checked against the receipt at a glance.
   */
  protected chargeComplement(sheet: ExpenseSheet, kind: ChargeKind): string {
    const totals = this.store.split().sheetTotals.get(sheet.id);
    if (!totals?.itemsSubtotal) {
      return '';
    }
    const charge = sheet[kind];
    if (!charge.value) {
      return '';
    }
    if (charge.isPercent) {
      const amount = charge.value * totals.itemsSubtotal;
      return `${this.store.symbolFor(sheet)}${round(amount, 2).toFixed(2)}`;
    }
    return `${round((charge.value / totals.itemsSubtotal) * 100, 2).toFixed(2)}%`;
  }

  // --- Sheet ------------------------------------------------------------

  protected removeSheet(sheetId: string): void {
    this.store.removeSheet(sheetId);
    this.close();
  }
}
