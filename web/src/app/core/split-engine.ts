/**
 * The calculation engine — a direct port of the Split Spreadsheet's formulas.
 *
 * Everything here is pure: `computeSplit(trip)` takes the whole trip and
 * returns every derived number the UI shows. No Angular, no state, no I/O,
 * so the whole business model is testable in isolation.
 *
 * Each exported step names the workbook cell it replaces. See
 * `docs/SPREADSHEET-FORMULAS.md` for the original formula text side by side.
 */

import {
  DEFAULT_CURRENCY,
  ExpenseItem,
  ExpenseSheet,
  Share,
  Trip,
} from '../models/trip.model';
import { UNITS_PER_USD } from '../data/currencies';

/**
 * Rounding to `digits` decimals, matching Google Sheets' ROUND(): half away
 * from zero, and *not* fooled by binary representation.
 *
 * `13.515 * 100` is 1351.4999999999998 in IEEE-754, so the naive
 * multiply-and-round returns 13.51 where the spreadsheet returns 13.52. The
 * decimal exponent is applied through the number's string form instead, which
 * keeps the shift exact.
 */
export function round(value: number, digits = 2): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const sign = value < 0 ? -1 : 1;
  const text = Math.abs(value).toString();
  if (text.includes('e')) {
    // Already in exponential form (very large or very small); the string trick
    // does not apply, and at these magnitudes the naive path is exact enough.
    const factor = 10 ** digits;
    return (sign * Math.round(Math.abs(value) * factor)) / factor;
  }
  const shifted = Math.round(Number(`${text}e${digits}`));
  return sign * Number(`${shifted}e-${digits}`);
}

/**
 * Conversion factor from `from` into `to`, via the USD-referenced snapshot.
 * Workbook: `Exchange_Rate(D1, SelectedMainCurrencyAbbr, Today())`.
 * Returns null when either currency has no rate on file.
 */
export function autoRate(from: string, to: string): number | null {
  if (from === to) {
    return 1;
  }
  const fromUnits = UNITS_PER_USD[from];
  const toUnits = UNITS_PER_USD[to];
  if (!fromUnits || !toUnits) {
    return null;
  }
  return toUnits / fromUnits;
}

/**
 * Rate actually applied to a sheet (Expense Sheet C2).
 *  - default-currency sheets are always 1 (enforced by the sheet's own
 *    data validation: `If(D2, C2=1, C2>0)`);
 *  - an explicit override "pins" the rate;
 *  - otherwise the auto rate is used, falling back to 1 when unknown.
 */
export function sheetRate(sheet: ExpenseSheet, baseCurrency: string): number {
  if (sheet.currency === DEFAULT_CURRENCY || sheet.currency === baseCurrency) {
    return 1;
  }
  if (sheet.rateOverride != null && sheet.rateOverride > 0) {
    return sheet.rateOverride;
  }
  return autoRate(sheet.currency, baseCurrency) ?? 1;
}

/** True when the sheet's rate is a user-entered value rather than the daily feed. */
export function isRatePinned(sheet: ExpenseSheet, baseCurrency: string): boolean {
  return (
    sheet.currency !== DEFAULT_CURRENCY &&
    sheet.currency !== baseCurrency &&
    sheet.rateOverride != null &&
    sheet.rateOverride > 0
  );
}

/** Per-sheet totals, all in the sheet's own currency unless noted. */
export interface SheetTotals {
  /** Sum of item amounts. Workbook: `SUM(EXPENSESHEET_COL(C:C))`. */
  itemsSubtotal: number;
  /** Resolved tax amount (Expense Sheet E5). */
  tax: number;
  /** Resolved tip amount (Expense Sheet E6). */
  tip: number;
  /** Resolved discount, capped at the subtotal (Expense Sheet E7). */
  discount: number;
  /** `ROUND(subtotal + tax + tip - discount, 2)` — Expense Sheet C3. */
  total: number;
  /** Exchange rate applied to this sheet (Expense Sheet C2). */
  rate: number;
  /** `total * rate`, i.e. the sheet total in the trip's base currency. */
  totalInBase: number;
}

/**
 * Resolves one Tax/Tip/Discount cell.
 * Workbook: `IF(REGEXMATCH(txt, "%"), vals * total, vals)` (E5:E6), and E7
 * additionally clamps the discount with `MIN(total, amount)`.
 */
function resolveCharge(
  charge: { value: number; isPercent: boolean },
  itemsSubtotal: number,
): number {
  const raw = charge.isPercent ? charge.value * itemsSubtotal : charge.value;
  return Number.isFinite(raw) ? raw : 0;
}

export function computeSheetTotals(
  sheet: ExpenseSheet,
  baseCurrency: string,
): SheetTotals {
  const itemsSubtotal = sheet.items.reduce((sum, it) => sum + (it.amount ?? 0), 0);
  const tax = resolveCharge(sheet.tax, itemsSubtotal);
  const tip = resolveCharge(sheet.tip, itemsSubtotal);
  const discount = Math.min(itemsSubtotal, resolveCharge(sheet.discount, itemsSubtotal));
  const total = round(itemsSubtotal + tax + tip - discount, 2);
  const rate = sheetRate(sheet, baseCurrency);
  return {
    itemsSubtotal,
    tax,
    tip,
    discount,
    total,
    rate,
    totalInBase: total * rate,
  };
}

/** One row of the Split sheet's grid. */
export interface SplitRow {
  sheetId: string;
  sheetName: string;
  item: ExpenseItem;
  /** Item amount converted to base currency. Split column E. */
  baseAmount: number;
  /**
   * This item's proportional slice of the sheet's tax + tip - discount,
   * in base currency. Split column F, Expense Sheet D9:D19.
   */
  chargeShare: number;
  /** `baseAmount + chargeShare` — what actually gets divided up. */
  lineTotal: number;
  /** Sum of pay ratios on this row. Split column I. */
  payUnits: number;
  /** Sum of owe ratios on this row. Split column J. */
  costUnits: number;
  /** `lineTotal / payUnits`, or 0 when nobody paid. Split column G. */
  unitPaid: number;
  /** `lineTotal / costUnits`, or null when no owe ratios are set. Split column H. */
  unitCost: number | null;
  /** True when this sheet declares payers, so per-cell pay ratios are ignored. */
  usesSheetPayers: boolean;
  /** Sheet-level payer ids, empty unless `usesSheetPayers`. */
  sheetPayerIds: string[];
}

/**
 * Effective pay ratio of one person on one row.
 * Workbook (M5): when the sheet declares `ExplicitPayers`, each listed person
 * counts as exactly 1 and per-cell decimals are ignored; otherwise the cell's
 * own `MOD(cell,1)*10` is used.
 */
export function payRatio(row: SplitRow, personId: string, share: Share): number {
  if (row.usesSheetPayers) {
    return row.sheetPayerIds.includes(personId) ? 1 : 0;
  }
  return share.pay;
}

/** Balance and settlement info for one person. */
export interface PersonBalance {
  personId: string;
  name: string;
  /** Raw `owed - paid`, before the ±0.01 rounding pass. */
  rawBalance: number;
  /**
   * Final displayed amount (Split M2). Positive = this person still owes
   * money; negative = this person is owed and shows in parentheses/red.
   */
  balance: number;
  /** 1-based settlement group, or 0 when everyone settles together. */
  group: number;
}

export interface SplitResult {
  rows: SplitRow[];
  /**
   * Split A2 — the grand total in base currency, as the sum of each sheet's
   * own displayed total.
   *
   * The workbook summed the unrounded per-item columns instead, which can land
   * a cent away from the sheet totals the user is looking at (its own guide
   * shows $1,425.87 for a trip whose unrounded columns add up to $1,425.875).
   * Adding up what each sheet displays is both reproducible and checkable by
   * hand, so that is what this does.
   */
  grandTotal: number;
  balances: PersonBalance[];
  /** True when at least one payer is specified anywhere in the trip. */
  hasPayers: boolean;
  sheetTotals: Map<string, SheetTotals>;
}

/** Builds the Split sheet's rows: every item of every sheet, in sheet order. */
export function buildRows(trip: Trip): SplitRow[] {
  const rows: SplitRow[] = [];

  for (const sheet of trip.sheets) {
    const totals = computeSheetTotals(sheet, trip.baseCurrency);
    const { itemsSubtotal, tax, tip, discount, rate } = totals;
    // Expense Sheet D9:D19 — the per-item slice of tax + tip - discount.
    const chargePerUnit = itemsSubtotal === 0 ? 0 : (tax + tip - discount) / itemsSubtotal;

    const sheetPayerIds = sheet.paidBy.filter((id) =>
      trip.people.some((p) => p.id === id),
    );
    const usesSheetPayers = sheetPayerIds.length > 0;

    for (const item of sheet.items) {
      const amount = item.amount ?? 0;
      const baseAmount = amount * rate;
      const chargeShare = chargePerUnit * amount * rate;
      const lineTotal = baseAmount + chargeShare;

      const shares = trip.shares[item.id] ?? {};
      let costUnits = 0;
      let cellPayUnits = 0;
      for (const person of trip.people) {
        const share = shares[person.id];
        if (!share) {
          continue;
        }
        costUnits += share.owe;
        cellPayUnits += share.pay;
      }

      const payUnits = usesSheetPayers ? sheetPayerIds.length : cellPayUnits;

      rows.push({
        sheetId: sheet.id,
        sheetName: sheet.name,
        item,
        baseAmount,
        chargeShare,
        lineTotal,
        payUnits,
        costUnits,
        unitPaid: payUnits > 0 ? lineTotal / payUnits : 0,
        unitCost: costUnits > 0 ? lineTotal / costUnits : null,
        usesSheetPayers,
        sheetPayerIds,
      });
    }
  }

  return rows;
}

/**
 * Raw per-person balance (Split M5):
 *
 *   SUM( unitCost * TRUNC(share) - unitPaid * payRatio )
 *
 * Positive means the person consumed more than they put in, so they owe.
 */
export function computeRawBalances(trip: Trip, rows: SplitRow[]): Map<string, number> {
  const balances = new Map<string, number>();

  for (const person of trip.people) {
    let balance = 0;
    for (const row of rows) {
      const share = trip.shares[row.item.id]?.[person.id];
      const owe = share?.owe ?? 0;
      const paid = payRatio(row, person.id, share ?? { owe: 0, pay: 0 });
      balance += (row.unitCost ?? 0) * owe - row.unitPaid * paid;
    }
    // The workbook rounds to 3 here before the ±0.01 correction pass.
    balances.set(person.id, round(balance, 3));
  }

  return balances;
}

/**
 * The ±0.01 correction pass (Split M2).
 *
 * Rounding each balance independently can leave the column a cent or two off
 * the target. The workbook nudges `k` non-zero people in each settlement group
 * by one cent against the error, where `k = MIN(|error / 0.01|, candidates)`.
 * The result always reconciles.
 *
 * One deliberate divergence: the spreadsheet picked *who* absorbs the cent at
 * random (it kept a shuffled copy of the names in People!B). Here the people
 * are taken in list order, so the same inputs always produce the same output
 * and the displayed figures do not shuffle on every edit. Either choice is
 * arithmetically equivalent — only the recipient of the odd cent differs.
 *
 * Target per group:
 *  - when payers exist anywhere, each group's balances must sum to 0
 *    (money only moves between people);
 *  - when nobody paid, the single group must sum to the grand total
 *    (everyone is being charged their share).
 */
export function applyRoundingCorrection(
  trip: Trip,
  raw: Map<string, number>,
  groups: Map<string, number>,
  hasPayers: boolean,
  grandTotal: number,
): Map<string, number> {
  const step = 0.01;
  const rounded = new Map<string, number>();
  for (const [id, value] of raw) {
    rounded.set(id, round(value, 2));
  }

  const totalError = hasPayers
    ? sum([...rounded.values()])
    : sum([...rounded.values()]) - grandTotal;

  const groupIds = new Set(trip.people.map((p) => groups.get(p.id) ?? 0));
  const corrected = new Map(rounded);

  for (const group of groupIds) {
    // People sheet order decides who absorbs the cent — same as the workbook,
    // which filters People!B:B in sheet order.
    const members = trip.people.filter((p) => (groups.get(p.id) ?? 0) === group);
    const candidates = members.filter((p) => (rounded.get(p.id) ?? 0) !== 0);

    const error = hasPayers
      ? sum(members.map((p) => rounded.get(p.id) ?? 0))
      : totalError;

    if (round(error, 2) === 0 || candidates.length === 0) {
      continue;
    }

    const k = Math.min(Math.abs(Math.round(error / step)), candidates.length);
    const direction = Math.sign(error);

    for (let i = 0; i < k; i++) {
      const id = candidates[i].id;
      corrected.set(id, round((corrected.get(id) ?? 0) - direction * step, 2));
    }
  }

  return corrected;
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

/** Runs the whole pipeline. `groupsFor` supplies the settlement grouping. */
export function computeSplit(
  trip: Trip,
  groupsFor: (balances: Map<string, number>) => Map<string, number>,
): SplitResult {
  const rows = buildRows(trip);

  const sheetTotals = new Map<string, SheetTotals>();
  for (const sheet of trip.sheets) {
    sheetTotals.set(sheet.id, computeSheetTotals(sheet, trip.baseCurrency));
  }

  const grandTotal = round(
    [...sheetTotals.values()].reduce((total, s) => total + s.totalInBase, 0),
    2,
  );

  const raw = computeRawBalances(trip, rows);
  const hasPayers = rows.some((row) => row.payUnits > 0);
  const groups = hasPayers ? groupsFor(raw) : new Map<string, number>();
  const corrected = applyRoundingCorrection(trip, raw, groups, hasPayers, grandTotal);

  const balances: PersonBalance[] = trip.people.map((person) => ({
    personId: person.id,
    name: person.name,
    rawBalance: raw.get(person.id) ?? 0,
    balance: corrected.get(person.id) ?? 0,
    group: groups.get(person.id) ?? 0,
  }));

  return { rows, grandTotal, balances, hasPayers, sheetTotals };
}
