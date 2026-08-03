import { SavedSplit, newSavedSplit } from '../models/library.model';
import { buildSampleTrip } from '../data/sample-trips';
import { Trip } from '../models/trip.model';
import { normalizeForSearch, searchSplits } from './split-search';

function splitOf(sample: Parameters<typeof buildSampleTrip>[0], id: string): SavedSplit {
  return newSavedSplit(buildSampleTrip(sample), id, '2026-08-01T00:00:00.000Z');
}

/** The library used by most of the tests below. */
function library(): SavedSplit[] {
  return [
    splitOf('restaurant', 'restaurant'), // Jack, Chris, Rose — Beer, Pizza, …
    splitOf('camping', 'camping'), // Jack, Rich, Emily, … — Campsite, Beef, …
    splitOf('new-england', 'new-england'), // sheets: General, McDonalds, Peruvian, …
  ];
}

function idsFor(query: string): string[] {
  return searchSplits(library(), query).map((match) => match.split.id);
}

describe('searchSplits', () => {
  it('returns everything for a blank query', () => {
    expect(idsFor('')).toEqual(['restaurant', 'camping', 'new-england']);
    expect(idsFor('   ')).toEqual(['restaurant', 'camping', 'new-england']);
  });

  it('preserves the order it was given', () => {
    const reversed = library().reverse();
    expect(searchSplits(reversed, 'jack').map((m) => m.split.id)).toEqual([
      'camping',
      'restaurant',
    ]);
  });

  it('matches on the title', () => {
    expect(idsFor('new england')).toEqual(['new-england']);
    // "Cheesecake Factory" is the restaurant split's *title* and also one of the
    // New England trip's expense sheets, so both are genuine matches.
    expect(idsFor('cheesecake')).toEqual(['restaurant', 'new-england']);
  });

  it('matches on a person, which is how people remember a split', () => {
    expect(idsFor('rose')).toEqual(['restaurant']);
    expect(idsFor('emily')).toEqual(['camping']);
    expect(idsFor('jack')).toEqual(['restaurant', 'camping']);
  });

  it('matches on an expense sheet name', () => {
    // The guide's advice is to rename sheets to the restaurant.
    expect(idsFor('peruvian')).toEqual(['new-england']);
    expect(idsFor('mcdonalds')).toEqual(['new-england']);
  });

  it('matches on an item', () => {
    expect(idsFor('mosquito')).toEqual(['camping']);
    expect(idsFor('plane tickets')).toEqual(['new-england']);
  });

  it('is case insensitive and matches partial words', () => {
    expect(idsFor('CAMPSITE')).toEqual(['camping']);
    // A title, an item, and a sheet name respectively.
    expect(idsFor('cheese')).toEqual(['restaurant', 'camping', 'new-england']);
  });

  it('combines several words with AND', () => {
    // Jack is in both; only the camping trip also has firewood.
    expect(idsFor('jack firewood')).toEqual(['camping']);
    expect(idsFor('jack unicorn')).toEqual([]);
  });

  it('requires each word to be found within a single field', () => {
    const trip: Trip = buildSampleTrip('restaurant');
    trip.people = [
      { id: 'a', name: 'Ann' },
      { id: 'b', name: 'Bob' },
    ];
    const splits = [newSavedSplit(trip, 'x', '2026-08-01T00:00:00.000Z')];

    // Each term lands in some field: fine.
    expect(searchSplits(splits, 'ann bob').length).toBe(1);
    // A phrase spanning two unrelated names is not a match.
    expect(searchSplits(splits, 'ann bo').length).toBe(1); // "bo" is inside "Bob"
    expect(searchSplits(splits, 'annbob').length).toBe(0);
  });

  it('finds nothing when nothing matches', () => {
    expect(idsFor('helicopter')).toEqual([]);
  });
});

describe('searchSplits — explaining the match', () => {
  it('says nothing when the title itself matched', () => {
    const [match] = searchSplits(library(), 'cheesecake factory');
    expect(match.reasons).toEqual([]);
  });

  it('names the person that matched', () => {
    const [match] = searchSplits(library(), 'rose');
    expect(match.reasons).toEqual([{ kind: 'person', label: 'Rose' }]);
  });

  it('names the sheet and the item that matched', () => {
    const [sheetMatch] = searchSplits(library(), 'peruvian');
    expect(sheetMatch.reasons).toEqual([{ kind: 'sheet', label: 'Peruvian' }]);

    const [itemMatch] = searchSplits(library(), 'mosquito');
    expect(itemMatch.reasons).toEqual([
      { kind: 'item', label: 'Mosquito Repellent' },
    ]);
  });

  it('collects a reason per matching term', () => {
    const [match] = searchSplits(library(), 'jack firewood');
    expect(match.reasons).toEqual([
      { kind: 'person', label: 'Jack' },
      { kind: 'item', label: 'Firewood' },
    ]);
  });

  it('does not repeat the same reason twice', () => {
    const trip: Trip = buildSampleTrip('restaurant');
    trip.sheets[0].items.push(
      { id: 'x1', name: 'Coffee', amount: 3 },
      { id: 'x2', name: 'Coffee', amount: 3 },
    );
    const [match] = searchSplits([newSavedSplit(trip, 'x', '2026-08-01T00:00:00.000Z')], 'coffee');
    expect(match.reasons).toEqual([{ kind: 'item', label: 'Coffee' }]);
  });

  it('ignores blank names', () => {
    const trip: Trip = buildSampleTrip('restaurant');
    trip.people.push({ id: 'blank', name: '   ' });
    const [match] = searchSplits([newSavedSplit(trip, 'x', '2026-08-01T00:00:00.000Z')], 'pizza');
    expect(match.reasons.every((r) => r.label.trim() !== '')).toBe(true);
  });
});

describe('normalizeForSearch', () => {
  it('folds case and surrounding space', () => {
    expect(normalizeForSearch('  Ann  ')).toBe('ann');
  });

  it('folds Latin accents, so "jose" finds "José"', () => {
    expect(normalizeForSearch('José')).toBe(normalizeForSearch('jose'));
    expect(normalizeForSearch('Zürich')).toBe(normalizeForSearch('zurich'));
  });

  it('folds the Arabic letters that duplicate their Persian counterparts', () => {
    // Visually identical, different code points: without this, a name typed one
    // way never finds the same name stored the other way.
    expect(normalizeForSearch('یک')).toBe(normalizeForSearch('يك'));
  });

  it('treats a zero-width non-joiner as a word break', () => {
    expect(normalizeForSearch('می‌رود')).toContain(' ');
  });

  it('strips Persian harakat', () => {
    expect(normalizeForSearch('سَفر')).toBe('سفر');
  });
});

describe('searchSplits — beyond ASCII', () => {
  it('finds a split whose people are named in Persian', () => {
    const trip: Trip = buildSampleTrip('restaurant');
    trip.title = 'سفر شمال';
    trip.people = [{ id: 'p', name: 'سارا' }];
    const splits = [newSavedSplit(trip, 'x', '2026-08-01T00:00:00.000Z')];

    expect(searchSplits(splits, 'سارا').length).toBe(1);
    expect(searchSplits(splits, 'شمال').length).toBe(1);
  });

  it('finds an accented name typed without the accent', () => {
    const trip: Trip = buildSampleTrip('restaurant');
    trip.people = [{ id: 'p', name: 'José' }];
    const splits = [newSavedSplit(trip, 'x', '2026-08-01T00:00:00.000Z')];

    const [match] = searchSplits(splits, 'jose');
    expect(match).toBeTruthy();
    // The reason shows the name as it was written, not as it was folded.
    expect(match.reasons).toEqual([{ kind: 'person', label: 'José' }]);
  });
});
