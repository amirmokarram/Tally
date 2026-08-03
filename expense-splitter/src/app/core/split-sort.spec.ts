import { FakeStorage } from './library-storage.spec';
import {
  DEFAULT_SORT_ORDER,
  SORT_ORDER_KEY,
  SPLIT_SORT_OPTIONS,
  SortableSplit,
  SplitSortOrder,
  readSortOrder,
  sortSplits,
  writeSortOrder,
} from './split-sort';

function row(
  title: string,
  total: number,
  updatedAt: string,
  createdAt = updatedAt,
): SortableSplit & { title: string } {
  return { title, total, updatedAt, createdAt };
}

/** Titles in the order the given sort produces. */
function titlesOf(rows: readonly SortableSplit[], order: SplitSortOrder): string[] {
  return sortSplits(rows, order).map((entry) => entry.title);
}

describe('sortSplits', () => {
  const library = [
    row('Camping', 272.15, '2026-08-02T10:00:00.000Z', '2026-07-01T00:00:00.000Z'),
    row('Alps trip', 1425.87, '2026-08-01T10:00:00.000Z', '2026-08-01T00:00:00.000Z'),
    row('Dinner', 88.55, '2026-08-03T10:00:00.000Z', '2026-06-01T00:00:00.000Z'),
  ];

  it('orders by most recently edited', () => {
    expect(titlesOf(library, 'recent')).toEqual(['Dinner', 'Camping', 'Alps trip']);
  });

  it('orders by most recently added', () => {
    // Deliberately a different answer from "recently edited": Dinner is the
    // oldest split but the one touched last.
    expect(titlesOf(library, 'created')).toEqual(['Alps trip', 'Camping', 'Dinner']);
  });

  it('orders by name', () => {
    expect(titlesOf(library, 'name')).toEqual(['Alps trip', 'Camping', 'Dinner']);
  });

  it('orders by largest total', () => {
    expect(titlesOf(library, 'total')).toEqual(['Alps trip', 'Camping', 'Dinner']);
  });

  it('leaves the input array alone', () => {
    const input = [...library];
    sortSplits(input, 'name');
    expect(input).toEqual(library);
  });

  it('falls back to the default for an unknown order', () => {
    expect(titlesOf(library, 'nonsense' as SplitSortOrder)).toEqual(
      titlesOf(library, 'recent'),
    );
  });
});

describe('sortSplits — names', () => {
  it('sorts numbers within names the way people read them', () => {
    const rows = [
      row('Trip 10', 0, '2026-08-01T00:00:00.000Z'),
      row('Trip 2', 0, '2026-08-01T00:00:00.000Z'),
      row('Trip 1', 0, '2026-08-01T00:00:00.000Z'),
    ];
    expect(titlesOf(rows, 'name')).toEqual(['Trip 1', 'Trip 2', 'Trip 10']);
  });

  it('ignores case and accents, matching how search treats them', () => {
    const rows = [
      row('banana', 0, '2026-08-01T00:00:00.000Z'),
      row('Ápple', 0, '2026-08-01T00:00:00.000Z'),
      row('Cherry', 0, '2026-08-01T00:00:00.000Z'),
    ];
    expect(titlesOf(rows, 'name')).toEqual(['Ápple', 'banana', 'Cherry']);
  });

  it('sinks untitled splits to the bottom', () => {
    const rows = [
      row('   ', 0, '2026-08-03T00:00:00.000Z'),
      row('Zebra', 0, '2026-08-02T00:00:00.000Z'),
      row('', 0, '2026-08-01T00:00:00.000Z'),
      row('Apple', 0, '2026-08-04T00:00:00.000Z'),
    ];
    expect(titlesOf(rows, 'name')).toEqual(['Apple', 'Zebra', '   ', '']);
  });
});

describe('sortSplits — total ordering', () => {
  it('breaks equal names by most recently edited', () => {
    const rows = [
      row('New Split', 0, '2026-08-01T00:00:00.000Z'),
      row('New Split', 0, '2026-08-03T00:00:00.000Z'),
      row('New Split', 0, '2026-08-02T00:00:00.000Z'),
    ];
    expect(sortSplits(rows, 'name').map((r) => r.updatedAt)).toEqual([
      '2026-08-03T00:00:00.000Z',
      '2026-08-02T00:00:00.000Z',
      '2026-08-01T00:00:00.000Z',
    ]);
  });

  it('breaks equal totals by name', () => {
    const rows = [
      row('Charlie', 50, '2026-08-01T00:00:00.000Z'),
      row('Alice', 50, '2026-08-01T00:00:00.000Z'),
      row('Bob', 50, '2026-08-01T00:00:00.000Z'),
    ];
    expect(titlesOf(rows, 'total')).toEqual(['Alice', 'Bob', 'Charlie']);
  });

  it('breaks equal timestamps by name rather than leaving it to chance', () => {
    const same = '2026-08-01T00:00:00.000Z';
    const rows = [row('Charlie', 1, same), row('Alice', 2, same), row('Bob', 3, same)];
    expect(titlesOf(rows, 'recent')).toEqual(['Alice', 'Bob', 'Charlie']);
  });

  it('produces the same order however the input is arranged', () => {
    const same = '2026-08-01T00:00:00.000Z';
    const forwards = [row('Alice', 5, same), row('Bob', 5, same), row('Cara', 5, same)];
    const backwards = [...forwards].reverse();

    for (const order of SPLIT_SORT_OPTIONS) {
      expect(titlesOf(backwards, order.id))
        .withContext(order.id)
        .toEqual(titlesOf(forwards, order.id));
    }
  });

  it('tolerates an unparseable timestamp instead of scrambling the list', () => {
    const rows = [
      row('Broken', 0, 'not a date'),
      row('Fine', 0, '2026-08-01T00:00:00.000Z'),
    ];
    expect(titlesOf(rows, 'recent')).toEqual(['Fine', 'Broken']);
  });
});

describe('remembering the sort order', () => {
  let storage: FakeStorage;

  beforeEach(() => {
    storage = new FakeStorage();
  });

  it('round-trips the choice', () => {
    writeSortOrder(storage, 'total');
    expect(readSortOrder(storage)).toBe('total');
  });

  it('defaults when nothing is stored', () => {
    expect(readSortOrder(storage)).toBe(DEFAULT_SORT_ORDER);
  });

  it('defaults for a value it does not recognise', () => {
    storage.setItem(SORT_ORDER_KEY, 'by-vibes');
    expect(readSortOrder(storage)).toBe(DEFAULT_SORT_ORDER);
  });

  it('survives storage being unavailable', () => {
    expect(readSortOrder(null)).toBe(DEFAULT_SORT_ORDER);
    expect(() => writeSortOrder(null, 'name')).not.toThrow();

    storage.failWrites = true;
    expect(() => writeSortOrder(storage, 'name')).not.toThrow();
  });
});
