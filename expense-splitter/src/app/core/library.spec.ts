/**
 * Managing several saved splits.
 *
 * The invariant worth protecting here is that the library is never empty, so
 * every downstream `computed` can assume there is a trip to work on.
 */

import { TestBed } from '@angular/core/testing';

import { TripStore } from './trip-store';
import { SESSION_STORAGE, STORAGE_KEY, TRIP_STORAGE } from './library-storage';
import { FakeStorage } from './library-storage.spec';
import { newSavedSplit } from '../models/library.model';
import { buildSampleTrip } from '../data/sample-trips';

describe('the split library', () => {
  let storage: FakeStorage;
  let store: TripStore;

  beforeEach(() => {
    storage = new FakeStorage();
    TestBed.configureTestingModule({
      providers: [
        { provide: TRIP_STORAGE, useValue: storage },
        { provide: SESSION_STORAGE, useValue: new FakeStorage() },
      ],
    });
    store = TestBed.inject(TripStore);
  });

  afterEach(() => TestBed.resetTestingModule());

  it('starts with exactly one empty split', () => {
    expect(store.splits().length).toBe(1);
    expect(store.people().length).toBe(0);
    expect(store.activeSplitId()).toBe(store.splits()[0].id);
  });

  it('keeps splits independent of one another', () => {
    store.loadSample('restaurant');
    const first = store.activeSplitId();

    store.createSplit();
    store.loadSample('camping');
    const second = store.activeSplitId();

    expect(first).not.toBe(second);
    expect(store.people().length).toBe(6);
    expect(store.grandTotal()).toBe(272.15);

    store.openSplit(first);
    expect(store.people().length).toBe(3);
    expect(store.grandTotal()).toBe(109.23);
  });

  it('edits only the split that is open', () => {
    store.loadSample('restaurant');
    const restaurant = store.activeSplitId();
    store.createSplit();
    store.loadSample('camping');

    store.addPerson('Newcomer');

    expect(store.people().length).toBe(7);
    expect(store.splitById(restaurant)!.trip.people.length).toBe(3);
  });

  it('orders the library by most recently edited', () => {
    store.loadSample('restaurant');
    const first = store.activeSplitId();
    store.createSplit();
    const second = store.activeSplitId();

    expect(store.splits()[0].id).toBe(second);

    store.openSplit(first);
    store.setTitle('Touched last');
    expect(store.splits()[0].id).toBe(first);
  });

  it('bumps only the edited split’s timestamp', () => {
    store.loadSample('restaurant');
    const untouched = store.splitById(store.activeSplitId())!.updatedAt;
    store.createSplit();
    store.setTitle('Second');

    const first = store.splits().find((s) => s.trip.title === 'Cheesecake Factory')!;
    expect(first.updatedAt).toBe(untouched);
  });

  describe('duplicating', () => {
    it('copies the contents and opens the copy', () => {
      store.loadSample('new-england');
      const original = store.activeSplitId();

      const copy = store.duplicateSplit(original)!;

      expect(store.activeSplitId()).toBe(copy.id);
      expect(store.trip().title).toBe('Trip to New England (copy)');
      expect(store.grandTotal()).toBe(1425.87);
    });

    it('leaves the original untouched when the copy is edited', () => {
      store.loadSample('restaurant');
      const original = store.activeSplitId();
      store.duplicateSplit(original);

      store.addPerson('Only in the copy');

      expect(store.people().length).toBe(4);
      expect(store.splitById(original)!.trip.people.length).toBe(3);
    });

    it('returns null for a split that is not there', () => {
      expect(store.duplicateSplit('nonexistent')).toBeNull();
    });
  });

  describe('deleting', () => {
    it('falls through to the most recent remaining split', () => {
      store.loadSample('restaurant');
      const first = store.activeSplitId();
      store.createSplit();
      store.loadSample('camping');
      const second = store.activeSplitId();

      store.deleteSplit(second);

      expect(store.splits().length).toBe(1);
      expect(store.activeSplitId()).toBe(first);
      expect(store.people().length).toBe(3);
    });

    it('leaves a fresh split rather than an empty library', () => {
      store.loadSample('camping');
      store.deleteSplit(store.activeSplitId());

      expect(store.splits().length).toBe(1);
      expect(store.people().length).toBe(0);
      expect(store.activeSplitId()).toBe(store.splits()[0].id);
      // Everything downstream still works on the replacement.
      expect(store.grandTotal()).toBe(0);
    });

    it('keeps the open split open when a different one is deleted', () => {
      store.loadSample('restaurant');
      const open = store.activeSplitId();
      const other = store.createSplit().id;
      store.openSplit(open);

      store.deleteSplit(other);

      expect(store.activeSplitId()).toBe(open);
      expect(store.people().length).toBe(3);
    });
  });

  describe('importing', () => {
    it('adds to the library instead of replacing it', () => {
      store.loadSample('restaurant');
      const existing = store.activeSplitId();

      store.importSplits([newSavedSplit(buildSampleTrip('camping'), 'incoming')]);

      expect(store.splits().length).toBe(2);
      expect(store.splitById(existing)).toBeTruthy();
      expect(store.people().length).toBe(6);
    });

    it('assigns fresh ids, so importing twice gives two copies', () => {
      const incoming = [newSavedSplit(buildSampleTrip('camping'), 'same-id')];

      const first = store.importSplits(incoming);
      const second = store.importSplits(incoming);

      expect(first[0].id).not.toBe('same-id');
      expect(second[0].id).not.toBe(first[0].id);
      expect(store.splits().length).toBe(3); // the starting empty one, plus two
    });

    it('opens the first imported split', () => {
      const added = store.importSplits([
        newSavedSplit(buildSampleTrip('camping'), 'a'),
        newSavedSplit(buildSampleTrip('restaurant'), 'b'),
      ]);
      expect(store.activeSplitId()).toBe(added[0].id);
      expect(store.people().length).toBe(6);
    });

    it('does nothing when handed nothing', () => {
      const before = store.activeSplitId();
      expect(store.importSplits([])).toEqual([]);
      expect(store.splits().length).toBe(1);
      expect(store.activeSplitId()).toBe(before);
    });
  });

  describe('persistence', () => {
    it('saves every split, not just the open one', () => {
      store.loadSample('restaurant');
      store.createSplit();
      store.loadSample('camping');
      TestBed.flushEffects();

      const saved = JSON.parse(storage.getItem(STORAGE_KEY)!);
      expect(saved.splits.length).toBe(2);
      expect(saved.splits.map((s: { trip: { title: string } }) => s.trip.title).sort()).toEqual(
        ['Camping', 'Cheesecake Factory'],
      );
    });

    it('restores the whole library on start-up', () => {
      store.loadSample('restaurant');
      store.createSplit();
      store.loadSample('camping');
      TestBed.flushEffects();
      TestBed.resetTestingModule();

      TestBed.configureTestingModule({
        providers: [
          { provide: TRIP_STORAGE, useValue: storage },
          { provide: SESSION_STORAGE, useValue: new FakeStorage() },
        ],
      });
      const reloaded = TestBed.inject(TripStore);

      expect(reloaded.restoredFromStorage).toBe(true);
      expect(reloaded.splits().length).toBe(2);
      expect(reloaded.splits().map((s) => s.trip.title).sort()).toEqual([
        'Camping',
        'Cheesecake Factory',
      ]);
    });
  });
});
