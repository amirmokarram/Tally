/**
 * The ledger's row array.
 *
 * The shape matters more than it looks: the rows carry the grouping (adjacent
 * rows sharing a sheet id are drawn as one spanned cell) and the only way to
 * add an item or a sheet. Get the order wrong and sheets merge visually; drop
 * the trailing rows and there is no way to enter anything.
 */

import { ExpenseSheet, amountCharge } from '../models/trip.model';
import { SplitRow } from '../core/split-engine';
import { buildLedgerRows, ledgerRowId, sheetCaption } from './ledger-model';

function sheet(id: string, name: string): ExpenseSheet {
  return {
    id,
    name,
    currency: 'DEFAULT',
    rateOverride: null,
    paidBy: [],
    tax: amountCharge(0),
    tip: amountCharge(0),
    discount: amountCharge(0),
    items: [],
  };
}

function row(sheetId: string, itemId: string): SplitRow {
  return {
    sheetId,
    sheetName: sheetId,
    item: { id: itemId, name: itemId, amount: 10 },
    baseAmount: 10,
    chargeShare: 0,
    lineTotal: 10,
    payUnits: 0,
    costUnits: 0,
    unitPaid: 0,
    unitCost: null,
    usesSheetPayers: false,
    sheetPayerIds: [],
  };
}

describe('the ledger row array', () => {
  it('keeps each sheet’s items together, in sheet order', () => {
    const sheets = [sheet('s1', 'Dinner'), sheet('s2', 'Taxi')];
    // Deliberately interleaved: the split engine emits in sheet order, but the
    // grouping must come from the sheets, not from the order rows arrive in.
    const rows = [row('s2', 'i3'), row('s1', 'i1'), row('s1', 'i2')];

    const ledger = buildLedgerRows(rows, sheets);

    expect(ledger.map(ledgerRowId)).toEqual([
      'item:i1',
      'item:i2',
      'add-item:s1',
      'item:i3',
      'add-item:s2',
    ]);
  });

  it('gives an empty sheet a row to add its first item on', () => {
    const ledger = buildLedgerRows([], [sheet('s1', 'Dinner')]);

    // Without this the sheet would be invisible the moment it was created,
    // with no way to put anything on it.
    expect(ledger.map(ledgerRowId)).toEqual(['add-item:s1']);
  });

  it('is empty when there are no sheets — adding one is a button below the grid', () => {
    expect(buildLedgerRows([], [])).toEqual([]);
  });

  it('tags item rows with the sheet they belong to', () => {
    const ledger = buildLedgerRows([row('s1', 'i1')], [sheet('s1', 'Dinner')]);

    // This value is what AG Grid spans on: same sheet id on adjacent rows is
    // what draws them as one block.
    expect(ledger.map((r) => r.sheetId)).toEqual(['s1', 's1']);
  });
});

describe('the sheet caption', () => {
  it('names only the charges that are actually set', () => {
    const totals = {
      itemsSubtotal: 100,
      tax: 8,
      tip: 0,
      discount: 5,
      total: 103,
      rate: 1,
      totalInBase: 103,
    };

    expect(sheetCaption(totals)).toBe('Tax 8.00 · Disc 5.00');
  });

  it('says nothing when there are no charges', () => {
    expect(
      sheetCaption({
        itemsSubtotal: 100,
        tax: 0,
        tip: 0,
        discount: 0,
        total: 100,
        rate: 1,
        totalInBase: 100,
      }),
    ).toBe('');
    expect(sheetCaption(undefined)).toBe('');
  });
});
