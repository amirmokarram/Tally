import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import {
  DEFAULT_CURRENCY,
  ExpenseSheet,
  formatCharge,
  parseCharge,
} from '../models/trip.model';
import { TripStore } from '../core/trip-store';
import { MoneyPipe } from '../core/money.pipe';
import { round } from '../core/split-engine';
import { CurrencyPicker } from './currency-picker';

type ChargeKind = 'tax' | 'tip' | 'discount';

/**
 * The Expense Sheets — one tab per check, receipt or expense category.
 *
 * Each sheet keeps its own currency, its own tax/tip/discount, and optionally
 * a sheet-level "Paid By", which is the shortcut for "one or two people
 * covered this whole check".
 */
@Component({
  selector: 'app-expenses-panel',
  imports: [MoneyPipe, CurrencyPicker],
  templateUrl: './expenses-panel.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
    }

    .sheet-tabs {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
      margin-bottom: 16px;
    }

    .sheet-tab {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 7px 12px;
      border: 1px solid var(--border-strong);
      border-radius: 999px;
      background: var(--surface);
      font-size: 14px;
      font-weight: 550;

      &.active {
        background: var(--navy-800);
        border-color: var(--navy-800);
        color: var(--text-invert);
      }

      &.has-error:not(.active) {
        border-color: var(--credit);
        color: var(--credit);
      }
    }

    .sheet-body {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 300px;
      gap: 20px;
      align-items: start;

      @media (max-width: 900px) {
        grid-template-columns: minmax(0, 1fr);
      }
    }

    .panel {
      padding: 16px;
    }

    .panel + .panel {
      margin-top: 16px;
    }

    .panel h3 {
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--text-muted);
      margin-bottom: 12px;
    }

    .row {
      display: grid;
      grid-template-columns: 120px minmax(0, 1fr);
      align-items: center;
      gap: 10px;
      margin-bottom: 10px;
    }

    .row label {
      font-size: 14px;
      color: var(--text-muted);
    }

    .rate-hint {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: var(--text-muted);
      margin: -4px 0 10px 130px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
    }

    th {
      background: var(--navy-800);
      color: var(--text-invert);
      font-size: 13px;
      font-weight: 600;
      text-align: left;
      padding: 8px 10px;

      &.amount {
        text-align: right;
        width: 150px;
      }

      &.actions {
        width: 40px;
      }
    }

    td {
      padding: 4px 6px;
      border-bottom: 1px solid var(--border);
    }

    tbody tr:nth-child(odd) {
      background: var(--surface-alt);
    }

    tfoot td {
      border-bottom: none;
      padding-top: 10px;
      font-weight: 650;
    }

    .total-label {
      text-align: right;
      color: var(--text-muted);
      font-weight: 550;
    }

    .total-value {
      text-align: right;
      font-size: 16px;
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
      min-width: 78px;
      text-align: right;
    }

    .payers {
      display: flex;
      flex-direction: column;
      gap: 6px;
      max-height: 240px;
      overflow-y: auto;
    }

    .payer {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 14px;
    }

    .issues {
      margin-top: 12px;
      padding: 10px 12px;
      border-radius: var(--radius-sm);
      background: var(--credit-bg);
      color: var(--credit);
      font-size: 13px;

      &.warning {
        background: var(--warn-bg);
        color: var(--warn);
      }

      ul {
        margin: 0;
        padding-left: 18px;
      }
    }

    .hint {
      font-size: 12px;
      color: var(--text-muted);
      margin: 8px 0 0;
    }

    .empty {
      padding: 28px 16px;
      text-align: center;
      color: var(--text-muted);
    }
  `,
})
export class ExpensesPanel {
  protected readonly store = inject(TripStore);

  private readonly selectedId = signal<string | null>(null);

  /** Selected sheet, falling back to the first one after adds and deletes. */
  protected readonly sheet = computed<ExpenseSheet | undefined>(() => {
    const sheets = this.store.sheets();
    return sheets.find((s) => s.id === this.selectedId()) ?? sheets[0];
  });

  protected readonly totals = computed(() => {
    const sheet = this.sheet();
    return sheet ? this.store.split().sheetTotals.get(sheet.id) : undefined;
  });

  protected readonly issues = computed(() => {
    const sheet = this.sheet();
    return sheet ? (this.store.issuesBySheet().get(sheet.id) ?? []) : [];
  });

  protected select(sheetId: string): void {
    this.selectedId.set(sheetId);
  }

  protected sheetHasError(sheetId: string): boolean {
    return (this.store.issuesBySheet().get(sheetId) ?? []).some(
      (i) => i.severity === 'error',
    );
  }

  protected addSheet(): void {
    this.selectedId.set(this.store.addSheet().id);
  }

  protected removeSheet(sheetId: string): void {
    this.store.removeSheet(sheetId);
    this.selectedId.set(null);
  }

  // --- Currency ---------------------------------------------------------

  protected symbol(sheet: ExpenseSheet): string {
    return this.store.symbolFor(sheet);
  }

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
    const totals = this.totals();
    if (!totals || !totals.itemsSubtotal) {
      return '';
    }
    const charge = sheet[kind];
    if (!charge.value) {
      return '';
    }
    if (charge.isPercent) {
      const amount = charge.value * totals.itemsSubtotal;
      return `${this.symbol(sheet)}${round(amount, 2).toFixed(2)}`;
    }
    return `${round((charge.value / totals.itemsSubtotal) * 100, 2).toFixed(2)}%`;
  }

  // --- Items ------------------------------------------------------------

  protected onItemName(sheetId: string, itemId: string, event: Event): void {
    this.store.updateItem(sheetId, itemId, {
      name: (event.target as HTMLInputElement).value,
    });
  }

  protected onItemAmount(sheetId: string, itemId: string, event: Event): void {
    const raw = (event.target as HTMLInputElement).value.trim();
    const amount = raw === '' ? null : Number(raw.replace(/,/g, ''));
    this.store.updateItem(sheetId, itemId, {
      amount: amount !== null && Number.isFinite(amount) ? amount : null,
    });
  }

  protected onItemKey(event: KeyboardEvent, sheetId: string, isLast: boolean): void {
    if (event.key === 'Enter' && isLast) {
      this.store.addItem(sheetId);
    }
  }

  protected itemHasError(itemId: string): boolean {
    return this.issues().some((i) => i.itemId === itemId && i.severity === 'error');
  }
}
