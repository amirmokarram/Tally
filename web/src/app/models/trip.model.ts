/**
 * Domain model for a split — the web equivalent of one copy of the
 * "Split Spreadsheet" workbook.
 *
 * Workbook mapping
 * ----------------
 *   Trip           the whole spreadsheet file (Split + People + Expense Sheets)
 *   Person         one row of the People sheet
 *   ExpenseSheet   one Expense Sheet tab (Expenses / McDonalds / Peruvian / ...)
 *   ExpenseItem    one Item/Amount row of an Expense Sheet
 *   Share          one cell of the split grid on the Split sheet
 */

/** Sentinel meaning "follow the trip's base currency" (Expense sheet C1 = "Default"). */
export const DEFAULT_CURRENCY = 'DEFAULT';

/**
 * Tax / Tip / Discount input. The workbook stores a single cell (C5:C7) whose
 * *text* is inspected for a "%" to decide between a flat amount and a
 * percentage of the item subtotal.
 */
export interface Charge {
  /** Numeric value. For percentages this is the fraction, e.g. 0.15 for 15%. */
  value: number;
  /** True when `value` is a fraction of the item subtotal rather than an amount. */
  isPercent: boolean;
}

export function amountCharge(value = 0): Charge {
  return { value, isPercent: false };
}

export function percentCharge(fraction = 0): Charge {
  return { value: fraction, isPercent: true };
}

/**
 * Parses what the user typed into a Tax/Tip/Discount box, keeping the
 * spreadsheet's single-field convention: `15%` is a percentage of the item
 * subtotal, anything else is a flat amount. Returns null for unusable input.
 */
export function parseCharge(text: string): Charge | null {
  const trimmed = text.trim();
  if (trimmed === '') {
    return amountCharge(0);
  }
  const isPercent = trimmed.endsWith('%');
  const numeric = Number(trimmed.replace(/[%,\s]/g, ''));
  if (!Number.isFinite(numeric) || numeric < 0) {
    return null;
  }
  return isPercent ? percentCharge(numeric / 100) : amountCharge(numeric);
}

/** Renders a {@link Charge} back into the text the user would have typed. */
export function formatCharge(charge: Charge): string {
  if (charge.isPercent) {
    return `${round(charge.value * 100, 4)}%`;
  }
  return charge.value ? round(charge.value, 2).toString() : '';
}

export interface Person {
  readonly id: string;
  name: string;
}

export interface ExpenseItem {
  readonly id: string;
  /** Item label, Expense Sheet column A. */
  name: string;
  /** Amount in the *sheet's* currency, Expense Sheet column C. Null = not entered. */
  amount: number | null;
}

export interface ExpenseSheet {
  readonly id: string;
  /** Tab name. Must be unique within the trip. */
  name: string;
  /** `DEFAULT_CURRENCY` or a currency code from the catalogue (Expense Sheet C1). */
  currency: string;
  /**
   * Manual exchange-rate override (Expense Sheet C2, "pinned" 📌).
   * Null means "use the auto rate", which the workbook refreshed about once a day.
   * Ignored entirely when `currency` is `DEFAULT_CURRENCY`, where the rate is 1.
   */
  rateOverride: number | null;
  /**
   * Sheet-level payers (Expense Sheet C4, the `ExplicitPayers` named range).
   * Empty means "payers are given per item in the split grid".
   * When non-empty the whole sheet's cost is split equally between these people.
   */
  paidBy: string[];
  tax: Charge;
  tip: Charge;
  discount: Charge;
  items: ExpenseItem[];
}

/**
 * One split-grid cell. The workbook packs both numbers into a single decimal
 * `owe.pay` (integer part = owe ratio, first decimal digit = pay ratio), so
 * `1.2` reads as "owes 1 unit, paid 2 units".
 */
export interface Share {
  /** Relative amount this person owes toward the item. Spreadsheet: `TRUNC(cell)`. */
  owe: number;
  /** Relative amount this person already paid for the item. Spreadsheet: `MOD(cell,1)*10`. */
  pay: number;
}

export const EMPTY_SHARE: Share = { owe: 0, pay: 0 };

export interface Trip {
  /** Split sheet D1 / the file name. */
  title: string;
  /** Base currency code every amount is converted to for splitting (Split E2). */
  baseCurrency: string;
  people: Person[];
  sheets: ExpenseSheet[];
  /**
   * Split grid contents, keyed `itemId` then `personId`.
   * Sparse: a missing entry is `EMPTY_SHARE`.
   */
  shares: Record<string, Record<string, Share>>;
}

/** Packs a {@link Share} back into the workbook's single-cell `owe.pay` decimal. */
export function packShare(share: Share): number | null {
  if (!share.owe && !share.pay) {
    return null;
  }
  return round(share.owe + share.pay / 10, 10);
}

/** Parses the workbook's `owe.pay` decimal (data validation allows 0 – 10). */
export function unpackShare(cell: number | null | undefined): Share {
  if (cell == null || Number.isNaN(cell)) {
    return { ...EMPTY_SHARE };
  }
  const owe = Math.trunc(cell);
  // Guard against binary float noise: 1.2 - 1 is 0.19999999999999996.
  const pay = Math.round((cell - owe) * 10);
  return { owe, pay };
}

function round(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}
