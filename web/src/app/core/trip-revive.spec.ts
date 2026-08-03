/**
 * Reviving a trip from untrusted input.
 *
 * Both the storage path and the file-import path go through `reviveTrip`, so
 * these rules apply to anything crossing into the app from outside.
 */

import { reviveTrip } from './trip-revive';

describe('reviveTrip', () => {
  it('rejects input that is not a coherent trip', () => {
    expect(reviveTrip(null)).toBeNull();
    expect(reviveTrip(42)).toBeNull();
    expect(reviveTrip('a trip, honest')).toBeNull();
    expect(reviveTrip({})).toBeNull();
    expect(reviveTrip({ people: 'nope', sheets: [] })).toBeNull();
    expect(reviveTrip({ people: [], sheets: 'nope' })).toBeNull();
  });

  it('drops malformed entries rather than the whole trip', () => {
    const revived = reviveTrip({
      title: 'Damaged',
      baseCurrency: 'EUR',
      people: [
        { id: 'p1', name: 'Ann' },
        null,
        { name: 'no id' },
        { id: 'p1', name: 'duplicate id' },
        { id: 'p2', name: 'Ben' },
      ],
      sheets: [
        {
          id: 's1',
          name: 'Dinner',
          items: [
            { id: 'i1', name: 'Pizza', amount: 20 },
            'garbage',
            { id: 'i1', name: 'duplicate id', amount: 1 },
            { id: 'i2', name: 'Unpriced', amount: 'twelve' },
          ],
        },
        'garbage',
      ],
      shares: {
        i1: { p1: { owe: 1, pay: 0 }, p2: { owe: 99, pay: 0 } },
        i2: 'garbage',
      },
    })!;

    expect(revived).toBeTruthy();
    expect(revived.title).toBe('Damaged');
    expect(revived.baseCurrency).toBe('EUR');
    expect(revived.people.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(revived.sheets.length).toBe(1);
    expect(revived.sheets[0].items.map((i) => i.id)).toEqual(['i1', 'i2']);
    // A non-numeric amount becomes "not entered", which validation then flags.
    expect(revived.sheets[0].items[1].amount).toBeNull();
    // An out-of-range share is dropped; the valid one on the same row survives.
    expect(revived.shares['i1']).toEqual({ p1: { owe: 1, pay: 0 } });
    expect(revived.shares['i2']).toBeUndefined();
  });

  it('fills in defaults for missing optional fields', () => {
    const revived = reviveTrip({ people: [], sheets: [{ id: 's1' }] })!;

    expect(revived.baseCurrency).toBe('USD');
    expect(revived.sheets[0].name).toBe('Expenses');
    expect(revived.sheets[0].currency).toBe('DEFAULT');
    expect(revived.sheets[0].rateOverride).toBeNull();
    expect(revived.sheets[0].paidBy).toEqual([]);
    expect(revived.sheets[0].tax).toEqual({ value: 0, isPercent: false });
    expect(revived.sheets[0].items).toEqual([]);
    expect(revived.shares).toEqual({});
  });

  it('keeps a Paid By pointing at a deleted person so validation can report it', () => {
    const revived = reviveTrip({
      people: [{ id: 'p1', name: 'Ann' }],
      sheets: [{ id: 's1', paidBy: ['p1', 'ghost'] }],
    })!;

    expect(revived.sheets[0].paidBy).toEqual(['p1', 'ghost']);
  });

  it('rejects a negative pinned rate', () => {
    const revived = reviveTrip({
      people: [],
      sheets: [{ id: 's1', currency: 'HUF', rateOverride: -3 }],
    })!;
    expect(revived.sheets[0].rateOverride).toBeNull();
  });
});
