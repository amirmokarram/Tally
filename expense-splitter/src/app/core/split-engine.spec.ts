/**
 * Regression fixtures taken from the original user guide.
 *
 * Every expected number below is read off a screenshot in `Help.pdf`. If the
 * engine ever stops reproducing them, it has diverged from the spreadsheet.
 */

import { Trip } from '../models/trip.model';
import { SampleTripId, buildSampleTrip } from '../data/sample-trips';
import { SplitResult, computeSheetTotals, computeSplit, round } from './split-engine';
import { assignTransactionGroups, buildTransfers } from './settlement';
import { tripIssues } from './validation';

function run(id: SampleTripId) {
  const trip = buildSampleTrip(id);
  const order = trip.people.map((p) => p.id);
  const result = computeSplit(trip, (b) => assignTransactionGroups(b, order));
  const byName = new Map(result.balances.map((b) => [b.name, b.balance]));
  return { trip, result, byName, order };
}

function totalOf(trip: Trip, sheetName: string) {
  const sheet = trip.sheets.find((s) => s.name === sheetName)!;
  return computeSheetTotals(sheet, trip.baseCurrency);
}

/**
 * Compares against the guide's published figures.
 *
 * The underlying arithmetic must match to the cent, but the odd ±0.01 that
 * makes the column reconcile may land on a different person than it did in the
 * screenshot: the spreadsheet chose that person at random, this engine chooses
 * deterministically. So the raw figure is checked tightly and the final figure
 * is allowed to differ by exactly that one cent.
 */
function expectPublishedBalances(
  result: SplitResult,
  published: Record<string, number>,
): void {
  const byName = new Map(result.balances.map((b) => [b.name, b]));
  for (const [name, value] of Object.entries(published)) {
    const balance = byName.get(name);
    expect(balance).withContext(`${name} is missing`).toBeDefined();
    expect(Math.abs(balance!.rawBalance - value))
      .withContext(`${name} raw ${balance!.rawBalance} vs published ${value}`)
      .toBeLessThan(0.01);
    expect(Math.abs(balance!.balance - value))
      .withContext(`${name} final ${balance!.balance} vs published ${value}`)
      .toBeLessThanOrEqual(0.0100001);
  }
}

describe('split engine — restaurant check (guide scenario 1)', () => {
  const { trip, result, byName } = run('restaurant');

  it('totals the check the way the Expenses sheet does', () => {
    const totals = totalOf(trip, 'Expenses');
    expect(totals.itemsSubtotal).toBeCloseTo(90.1, 2);
    expect(round(totals.tax, 2)).toBe(5.61);
    expect(round(totals.tip, 2)).toBe(13.52); // 15% of 90.10
    expect(totals.total).toBe(109.23);
  });

  it('charges each person their share', () => {
    expect(result.grandTotal).toBe(109.23);
    expect(byName.get('Jack')).toBe(33.07);
    expect(byName.get('Chris')).toBe(60.52);
    expect(byName.get('Rose')).toBe(15.64);
  });

  it('reconciles to the grand total when nobody is marked as payer', () => {
    const sum = result.balances.reduce((t, b) => t + b.balance, 0);
    expect(round(sum, 2)).toBe(result.grandTotal);
    expect(result.hasPayers).toBe(false);
  });

  it('reports no problems', () => {
    expect(tripIssues(trip, result.rows).filter((i) => i.severity === 'error')).toEqual([]);
  });
});

describe('split engine — camping trip (guide scenario 2)', () => {
  const { result } = run('camping');

  it('reproduces the published balances', () => {
    expect(result.grandTotal).toBe(272.15);
    expectPublishedBalances(result, {
      Jack: 43.46,
      Rich: -58.95,
      Emily: 12.69,
      Jane: 2.48,
      Bill: 2.67,
      Chris: -2.35,
    });
  });

  it('keeps everyone in one settlement group', () => {
    // Rich is the only substantial creditor, so no independent subset exists —
    // the guide shows uncoloured headers and "everyone pays Rich".
    expect(new Set(result.balances.map((b) => b.group))).toEqual(new Set([0]));
  });

  it('nets to zero once payers are involved', () => {
    expect(result.hasPayers).toBe(true);
    const sum = result.balances.reduce((t, b) => t + b.balance, 0);
    expect(round(sum, 2)).toBe(0);
  });
});

describe('split engine — trip to New England (guide scenario 3)', () => {
  const { trip, result, order } = run('new-england');

  it('totals every expense sheet separately', () => {
    expect(totalOf(trip, 'General').total).toBe(1073.56);
    expect(totalOf(trip, 'McDonalds').total).toBe(88.01);
    expect(totalOf(trip, 'Peruvian').total).toBe(114.06);
    expect(totalOf(trip, 'Cheesecake Factory').total).toBe(150.24);
    expect(result.grandTotal).toBe(1425.87);
  });

  it('applies the Peruvian discount proportionally, capped at the subtotal', () => {
    const totals = totalOf(trip, 'Peruvian');
    expect(round(totals.tax, 2)).toBe(6.06); // 6.25% of 97.00
    expect(round(totals.tip, 2)).toBe(16.0);
    expect(round(totals.discount, 2)).toBe(5.0);
  });

  it('reproduces the published balances', () => {
    expectPublishedBalances(result, {
      Harry: 132.54,
      Rich: 120.37,
      Joe: -783.24,
      Chris: 401.15,
      Will: 129.18,
    });
    expect(round(result.balances.reduce((t, b) => t + b.balance, 0), 2)).toBe(0);
  });

  it('splits a sheet-level check equally between its declared payers', () => {
    // Cheesecake Factory is paid by Chris and Harry, so each covers half of
    // its 150.24 total regardless of what they personally ate.
    const sheet = trip.sheets.find((s) => s.name === 'Cheesecake Factory')!;
    const rows = result.rows.filter((r) => r.sheetId === sheet.id);
    const paidByChris = rows.reduce((t, r) => t + r.unitPaid * 1, 0);
    expect(round(paidByChris, 2)).toBe(150.24 / 2);
  });

  it('settles with everyone paying Joe', () => {
    const balances = new Map(result.balances.map((b) => [b.personId, b.balance]));
    const groups = new Map(result.balances.map((b) => [b.personId, b.group]));
    const transfers = buildTransfers(balances, groups, order);
    const joe = trip.people.find((p) => p.name === 'Joe')!;

    expect(transfers.length).toBe(4);
    expect(transfers.every((t) => t.toPersonId === joe.id)).toBe(true);
    expect(round(transfers.reduce((t, x) => t + x.amount, 0), 2)).toBe(
      Math.abs(result.balances.find((b) => b.personId === joe.id)!.balance),
    );
  });
});

describe('split engine — debt simplification', () => {
  const { trip, result, order } = run('debt-simplification');

  it('reproduces the published balances', () => {
    expect(result.grandTotal).toBe(88.55);
    expectPublishedBalances(result, {
      Henry: -0.9,
      Harry: -9.61,
      Joe: 6.52,
      Dave: 15.18,
      Rich: -5.67,
      Bill: -8.61,
      Jeff: 3.09,
    });
  });

  it('breaks the seven people into two independent groups', () => {
    const groups = new Map(result.balances.map((b) => [b.name, b.group]));
    const distinct = new Set([...groups.values()]);
    expect(distinct.size).toBe(2);

    // {Harry, Joe, Jeff} and {Henry, Dave, Rich, Bill} are the only zero-sum split.
    expect(groups.get('Harry')).toBe(groups.get('Joe'));
    expect(groups.get('Harry')).toBe(groups.get('Jeff'));
    expect(groups.get('Henry')).toBe(groups.get('Dave'));
    expect(groups.get('Henry')).toBe(groups.get('Rich'));
    expect(groups.get('Henry')).toBe(groups.get('Bill'));
    expect(groups.get('Henry')).not.toBe(groups.get('Harry'));
  });

  it('needs fewer transfers than the single-hub baseline', () => {
    const balances = new Map(result.balances.map((b) => [b.personId, b.balance]));
    const groups = new Map(result.balances.map((b) => [b.personId, b.group]));
    const transfers = buildTransfers(balances, groups, order);

    // Baseline is people - 1 = 6; the two groups clear in 2 + 3 = 5.
    expect(transfers.length).toBeLessThan(trip.people.length - 1);
    expect(transfers.length).toBe(5);
    for (const transfer of transfers) {
      expect(groups.get(transfer.fromPersonId)).toBe(groups.get(transfer.toPersonId));
    }
  });

  it('clears every balance exactly', () => {
    const balances = new Map(result.balances.map((b) => [b.personId, b.balance]));
    const groups = new Map(result.balances.map((b) => [b.personId, b.group]));
    const ledger = new Map(balances);
    for (const transfer of buildTransfers(balances, groups, order)) {
      ledger.set(transfer.fromPersonId, ledger.get(transfer.fromPersonId)! - transfer.amount);
      ledger.set(transfer.toPersonId, ledger.get(transfer.toPersonId)! + transfer.amount);
    }
    for (const [, remaining] of ledger) {
      expect(round(remaining, 2)).toBe(0);
    }
  });
});

describe('validation', () => {
  it('flags an item nobody has a share of', () => {
    const trip = buildSampleTrip('restaurant');
    trip.shares = {};
    const order = trip.people.map((p) => p.id);
    const result = computeSplit(trip, (b) => assignTransactionGroups(b, order));
    const codes = tripIssues(trip, result.rows).map((i) => i.code);
    expect(codes).toContain('SHARE_VALUES_MISSING');
  });

  it('flags a per-cell payment on a sheet that already declares payers', () => {
    const trip = buildSampleTrip('new-england');
    const mcd = trip.sheets.find((s) => s.name === 'McDonalds')!;
    const coke = mcd.items.find((i) => i.name === 'Coke')!;
    const someone = trip.people[0].id;
    trip.shares[coke.id] = { ...trip.shares[coke.id], [someone]: { owe: 0, pay: 1 } };

    const order = trip.people.map((p) => p.id);
    const result = computeSplit(trip, (b) => assignTransactionGroups(b, order));
    const codes = tripIssues(trip, result.rows).map((i) => i.code);
    expect(codes).toContain('PAYER_ALREADY_SPECIFIED');
  });

  it('flags a priced item with no payer once anyone is paying', () => {
    const trip = buildSampleTrip('camping');
    const sheet = trip.sheets[0];
    const item = sheet.items[0];
    // Strip every pay ratio from the first row while others still have them.
    for (const share of Object.values(trip.shares[item.id])) {
      share.pay = 0;
    }

    const order = trip.people.map((p) => p.id);
    const result = computeSplit(trip, (b) => assignTransactionGroups(b, order));
    const codes = tripIssues(trip, result.rows).map((i) => i.code);
    expect(codes).toContain('PAYER_MISSING');
  });
});

describe('multi-currency', () => {
  it('converts a sheet with a pinned rate into the base currency', () => {
    const trip = buildSampleTrip('restaurant');
    const sheet = trip.sheets[0];
    sheet.currency = 'HUF';
    sheet.rateOverride = 0.00256; // the guide's Hungarian Forint example
    sheet.tax = { value: 0, isPercent: false };
    sheet.tip = { value: 0, isPercent: false };

    const totals = computeSheetTotals(sheet, trip.baseCurrency);
    expect(totals.rate).toBe(0.00256);
    expect(round(totals.totalInBase, 4)).toBe(round(90.1 * 0.00256, 4));
  });

  it('holds the rate at 1 for default-currency sheets', () => {
    const trip = buildSampleTrip('restaurant');
    const sheet = trip.sheets[0];
    sheet.rateOverride = 42; // must be ignored
    expect(computeSheetTotals(sheet, trip.baseCurrency).rate).toBe(1);
  });
});
