/**
 * Validation — the port of the workbook's error surface.
 *
 * Two levels, same as the spreadsheet:
 *  - `tripIssues` reproduces the single red message on the Split sheet (cell
 *    A3), including its priority order;
 *  - `sheetIssues` reproduces the per-cell red highlighting on an Expense
 *    Sheet (driven by cell F3 and the sheet's conditional formatting rules).
 */

import { DEFAULT_CURRENCY, ExpenseSheet, Trip } from '../models/trip.model';
import { UNITS_PER_USD } from '../data/currencies';
import { SplitRow } from './split-engine';

export type IssueSeverity = 'error' | 'warning';

export interface Issue {
  code: string;
  message: string;
  severity: IssueSeverity;
  /** Sheet the problem belongs to, when it is sheet-local. */
  sheetId?: string;
  /** Item the problem belongs to, when it is row-local. */
  itemId?: string;
}

/**
 * Trip-level problems, highest priority first — mirrors the `SWITCH(TRUE, ...)`
 * in Split!A3. The UI shows the first one, exactly like the single red cell.
 *
 * The workbook's two transient states ("Adding new Expense Sheet…" and
 * "Changing Currency Symbol…") have no equivalent here: those covered Apps
 * Script running asynchronously, and this app recalculates synchronously.
 */
export function tripIssues(trip: Trip, rows: SplitRow[]): Issue[] {
  const issues: Issue[] = [];

  if (!trip.baseCurrency) {
    issues.push({
      code: 'BASE_CURRENCY_MISSING',
      message: 'Select a base currency.',
      severity: 'error',
    });
    return issues;
  }

  const namedPeople = trip.people.filter((p) => p.name.trim() !== '');
  if (namedPeople.length === 0) {
    issues.push({
      code: 'NO_PEOPLE',
      message: 'Start by adding people, then add expenses.',
      severity: 'error',
    });
    return issues;
  }

  for (const row of rows) {
    if (row.item.name.trim() !== '' && row.item.amount == null) {
      issues.push({
        code: 'ITEM_AMOUNT_MISSING',
        message: `"${row.item.name}" has no amount.`,
        severity: 'error',
        sheetId: row.sheetId,
        itemId: row.item.id,
      });
    }
  }

  // Split!A3 `payerAlreadyInCheck`: a sheet declares payers, yet somebody also
  // carries a per-cell pay ratio on one of its rows. The two would double-count.
  for (const row of rows) {
    if (!row.usesSheetPayers || row.item.name.trim() === '') {
      continue;
    }
    const cellPay = Object.values(trip.shares[row.item.id] ?? {}).reduce(
      (total, share) => total + share.pay,
      0,
    );
    if (cellPay > 0) {
      issues.push({
        code: 'PAYER_ALREADY_SPECIFIED',
        message: `"${row.item.name}" has per-person payments, but ${row.sheetName} already declares who paid.`,
        severity: 'error',
        sheetId: row.sheetId,
        itemId: row.item.id,
      });
    }
  }

  // Split!A3 `shareValuesMissing`: the DIV/0 behind column H — an item that
  // costs something but nobody has been assigned a share of.
  for (const row of rows) {
    if (row.item.amount != null && row.lineTotal !== 0 && row.unitCost === null) {
      issues.push({
        code: 'SHARE_VALUES_MISSING',
        message: `Nobody is assigned a share of "${row.item.name}".`,
        severity: 'error',
        sheetId: row.sheetId,
        itemId: row.item.id,
      });
    }
  }

  // Split!H3 `paidByMissing`: payers exist somewhere, so every priced row needs
  // one. Half-specified payers silently distort the balances.
  const anyPayers = rows.some((row) => row.payUnits > 0);
  if (anyPayers) {
    for (const row of rows) {
      if (row.payUnits === 0 && row.lineTotal !== 0) {
        issues.push({
          code: 'PAYER_MISSING',
          message: `No payer for "${row.item.name}". Once anyone is marked as paying, every item needs a payer.`,
          severity: 'error',
          sheetId: row.sheetId,
          itemId: row.item.id,
        });
      }
    }
  }

  const seen = new Map<string, number>();
  for (const person of namedPeople) {
    const key = person.name.trim().toLowerCase();
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  for (const [name, count] of seen) {
    if (count > 1) {
      issues.push({
        code: 'DUPLICATE_PERSON',
        message: `"${name}" appears ${count} times in the people list.`,
        severity: 'warning',
      });
    }
  }

  return issues;
}

/** Per-sheet problems — the port of Expense Sheet F3 and its red formatting. */
export function sheetIssues(sheet: ExpenseSheet, trip: Trip): Issue[] {
  const issues: Issue[] = [];

  const isDefault = sheet.currency === DEFAULT_CURRENCY;
  if (!isDefault && !UNITS_PER_USD[sheet.currency]) {
    issues.push({
      code: 'UNKNOWN_CURRENCY',
      message: `No exchange rate on file for ${sheet.currency}. Enter one manually.`,
      severity: 'warning',
      sheetId: sheet.id,
    });
  }

  if (!isDefault && sheet.rateOverride != null && sheet.rateOverride <= 0) {
    issues.push({
      code: 'INVALID_RATE',
      message: 'Exchange rate must be a positive number.',
      severity: 'error',
      sheetId: sheet.id,
    });
  }

  const nameCounts = new Map<string, number>();
  for (const item of sheet.items) {
    const key = item.name.trim().toLowerCase();
    if (key) {
      nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
    }
  }

  for (const item of sheet.items) {
    const named = item.name.trim() !== '';
    const priced = item.amount != null;

    if (named && !priced) {
      issues.push({
        code: 'AMOUNT_MISSING',
        message: `"${item.name}" needs an amount.`,
        severity: 'error',
        sheetId: sheet.id,
        itemId: item.id,
      });
    }
    if (!named && priced) {
      issues.push({
        code: 'ITEM_NAME_MISSING',
        message: 'An amount was entered without an item name.',
        severity: 'error',
        sheetId: sheet.id,
        itemId: item.id,
      });
    }
    if (priced && (item.amount as number) < 0) {
      issues.push({
        code: 'NEGATIVE_AMOUNT',
        message: `"${item.name}" cannot be negative. Use the discount field instead.`,
        severity: 'error',
        sheetId: sheet.id,
        itemId: item.id,
      });
    }
    if (named && (nameCounts.get(item.name.trim().toLowerCase()) ?? 0) > 1) {
      issues.push({
        code: 'DUPLICATE_ITEM',
        message: `"${item.name}" is listed more than once. Combine identical items into one row.`,
        severity: 'error',
        sheetId: sheet.id,
        itemId: item.id,
      });
    }
  }

  for (const personId of sheet.paidBy) {
    if (!trip.people.some((p) => p.id === personId)) {
      issues.push({
        code: 'UNKNOWN_PAYER',
        message: 'Paid By refers to somebody who is no longer in the people list.',
        severity: 'error',
        sheetId: sheet.id,
      });
    }
  }

  const subtotal = sheet.items.reduce((total, item) => total + (item.amount ?? 0), 0);
  const discount = sheet.discount.isPercent
    ? sheet.discount.value * subtotal
    : sheet.discount.value;
  if (discount > subtotal && subtotal > 0) {
    issues.push({
      code: 'DISCOUNT_CAPPED',
      message: 'Discount is larger than the items subtotal, so it has been capped.',
      severity: 'warning',
      sheetId: sheet.id,
    });
  }

  return issues;
}
