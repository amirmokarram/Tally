/**
 * Multi-tab sync.
 *
 * Each test drives a real `TripStore` and dispatches the `storage` event the
 * browser would fire when another tab writes. The event never fires in the tab
 * that wrote, so anything the listener sees is by definition remote.
 */

import { TestBed } from '@angular/core/testing';

import { TripStore } from './trip-store';
import {
  APP_MARKER,
  SCHEMA_VERSION,
  SESSION_STORAGE,
  STORAGE_KEY,
  TRIP_STORAGE,
} from './library-storage';
import { FakeStorage } from './library-storage.spec';
import { SavedSplit, newSavedSplit } from '../models/library.model';
import { buildSampleTrip } from '../data/sample-trips';
import { SampleTripId } from '../data/sample-trips';

function documentFor(splits: readonly SavedSplit[]): string {
  return JSON.stringify({
    app: APP_MARKER,
    version: SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    splits,
  });
}

/** Simulates another tab writing this library. */
function otherTabWrites(splits: readonly SavedSplit[], key = STORAGE_KEY): void {
  window.dispatchEvent(new StorageEvent('storage', { key, newValue: documentFor(splits) }));
}

function splitOf(sample: SampleTripId, id: string): SavedSplit {
  return newSavedSplit(buildSampleTrip(sample), id, '2026-08-01T00:00:00.000Z');
}

/** Jumps past the active-edit window so a remote change is adopted, not queued. */
function afterTheEditWindow(run: () => void): void {
  jasmine.clock().install();
  jasmine.clock().mockDate(new Date(Date.now() + 60_000));
  try {
    run();
  } finally {
    jasmine.clock().uninstall();
  }
}

describe('multi-tab sync', () => {
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

  afterEach(() => {
    // Detaches the storage listener, so tests cannot leak into each other.
    TestBed.resetTestingModule();
  });

  it('adopts a change made in another tab while this one sits idle', () => {
    expect(store.people().length).toBe(0);

    // The other tab is editing the split this one is showing.
    const mine = store.activeSplitId();
    otherTabWrites([newSavedSplit(buildSampleTrip('camping'), mine)]);

    expect(store.people().map((p) => p.name)).toEqual([
      'Jack',
      'Rich',
      'Emily',
      'Jane',
      'Bill',
      'Chris',
    ]);
    expect(store.grandTotal()).toBe(272.15);
    expect(store.pendingRemote()).toBeNull();
    expect(store.syncedFromOtherTab()).toBe(true);
  });

  it('does not write an adopted change back to storage', () => {
    // Establish that autosave really does fire in this harness, otherwise the
    // assertion below would pass for the wrong reason.
    store.addPerson('Ana');
    TestBed.flushEffects();
    expect(storage.getItem(STORAGE_KEY)).withContext('autosave is live').not.toBeNull();
    storage.removeItem(STORAGE_KEY);

    // Now the echo this guards against: adopting sets the signal, the autosave
    // effect fires, the other tab sees a write, adopts, writes back, forever.
    const mine = store.activeSplitId();
    afterTheEditWindow(() =>
      otherTabWrites([newSavedSplit(buildSampleTrip('camping'), mine)]),
    );

    expect(store.people().length).withContext('the change was adopted').toBe(6);
    TestBed.flushEffects();
    // Nothing written: the library arrived from storage, it did not go back.
    expect(storage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('queues the change as a conflict when the user is editing this split', () => {
    store.addPerson('Ana'); // stamps a local edit just now

    const mine = store.activeSplitId();
    otherTabWrites([newSavedSplit(buildSampleTrip('camping'), mine)]);

    expect(store.pendingRemote()).toBeTruthy();
    // Local work is untouched until the user decides.
    expect(store.people().map((p) => p.name)).toEqual(['Ana']);
    expect(store.syncedFromOtherTab()).toBe(false);
  });

  it('adopts silently when another tab edits a *different* split', () => {
    // Mid-edit here, but the incoming change cannot disturb this view.
    store.addPerson('Ana');
    const mine = store.splitById(store.activeSplitId())!;

    otherTabWrites([mine, splitOf('camping', 'elsewhere')]);

    expect(store.pendingRemote()).withContext('not a conflict').toBeNull();
    expect(store.syncedFromOtherTab()).withContext('nothing to explain').toBe(false);
    expect(store.people().map((p) => p.name)).toEqual(['Ana']);
    // The new split still arrives in the library.
    expect(store.splits().length).toBe(2);
  });

  it('adopts once the local edit has gone stale', () => {
    store.addPerson('Ana');
    const mine = store.activeSplitId();

    afterTheEditWindow(() =>
      otherTabWrites([newSavedSplit(buildSampleTrip('restaurant'), mine)]),
    );

    expect(store.pendingRemote()).toBeNull();
    expect(store.people().map((p) => p.name)).toEqual(['Jack', 'Chris', 'Rose']);
  });

  it('takes the other tab’s version when the user accepts', () => {
    store.addPerson('Ana');
    const mine = store.activeSplitId();
    otherTabWrites([newSavedSplit(buildSampleTrip('restaurant'), mine)]);
    expect(store.pendingRemote()).toBeTruthy();

    store.acceptRemoteChange();

    expect(store.people().map((p) => p.name)).toEqual(['Jack', 'Chris', 'Rose']);
    expect(store.pendingRemote()).toBeNull();
  });

  it('republishes the local version when the user keeps it', () => {
    store.addPerson('Ana');
    TestBed.flushEffects();
    otherTabWrites([newSavedSplit(buildSampleTrip('restaurant'), store.activeSplitId())]);

    store.keepLocalVersion();

    expect(store.pendingRemote()).toBeNull();
    expect(store.people().map((p) => p.name)).toEqual(['Ana']);
    // The local version is now what any other tab will read.
    const stored = JSON.parse(storage.getItem(STORAGE_KEY)!);
    expect(stored.splits[0].trip.people[0].name).toBe('Ana');
  });

  it('falls back to another split when the open one is deleted elsewhere', () => {
    afterTheEditWindow(() => otherTabWrites([splitOf('camping', 'survivor')]));

    expect(store.activeSplitId()).toBe('survivor');
    expect(store.people().length).toBe(6);
  });

  it('ignores events for other keys and other storage areas', () => {
    otherTabWrites([splitOf('camping', 'x')], 'some.other.key');
    expect(store.splits().length).toBe(1);

    window.dispatchEvent(
      new StorageEvent('storage', {
        key: STORAGE_KEY,
        newValue: documentFor([splitOf('camping', 'x')]),
        storageArea: sessionStorage,
      }),
    );
    expect(store.splits().length).toBe(1);
  });

  it('ignores a cleared storage area rather than wiping the library', () => {
    store.loadSample('camping');
    window.dispatchEvent(new StorageEvent('storage', { key: null, newValue: null }));
    expect(store.people().length).toBe(6);
  });

  it('ignores a remote document it cannot read', () => {
    store.loadSample('camping');
    window.dispatchEvent(
      new StorageEvent('storage', { key: STORAGE_KEY, newValue: '{"version":2,"splits":9}' }),
    );
    expect(store.people().length).toBe(6);
  });

  it('treats an identical remote document as already converged', () => {
    store.addPerson('Ana');
    const mine = store.splitById(store.activeSplitId())!;

    // The other tab caught up with us and wrote the same thing back.
    otherTabWrites([JSON.parse(JSON.stringify(mine))]);

    expect(store.pendingRemote()).toBeNull();
    expect(store.syncedFromOtherTab()).toBe(false);
    expect(store.people().map((p) => p.name)).toEqual(['Ana']);
  });

  it('stops listening once destroyed', () => {
    store.loadSample('restaurant');
    const mine = store.activeSplitId();
    TestBed.resetTestingModule();

    otherTabWrites([newSavedSplit(buildSampleTrip('camping'), mine)]);

    // The destroyed store must not have reacted.
    expect(store.people().map((p) => p.name)).toEqual(['Jack', 'Chris', 'Rose']);
  });
});

describe('multi-tab sync — per-tab active split', () => {
  it('remembers which split this tab was showing across a reload', () => {
    const shared = new FakeStorage();
    const perTab = new FakeStorage();
    const library = [splitOf('restaurant', 'a'), splitOf('camping', 'b')];
    shared.setItem(STORAGE_KEY, documentFor(library));

    const configure = () => {
      TestBed.configureTestingModule({
        providers: [
          { provide: TRIP_STORAGE, useValue: shared },
          { provide: SESSION_STORAGE, useValue: perTab },
        ],
      });
      return TestBed.inject(TripStore);
    };

    const first = configure();
    first.openSplit('b');
    TestBed.flushEffects();
    expect(first.people().length).toBe(6);
    TestBed.resetTestingModule();

    // Same tab, reloaded: the per-tab pointer survives.
    const second = configure();
    expect(second.activeSplitId()).toBe('b');
    TestBed.resetTestingModule();
  });

  it('opens the most recent split when the tab has no pointer yet', () => {
    const shared = new FakeStorage();
    shared.setItem(
      STORAGE_KEY,
      documentFor([
        { ...splitOf('restaurant', 'old'), updatedAt: '2026-01-01T00:00:00.000Z' },
        { ...splitOf('camping', 'new'), updatedAt: '2026-08-01T00:00:00.000Z' },
      ]),
    );

    TestBed.configureTestingModule({
      providers: [
        { provide: TRIP_STORAGE, useValue: shared },
        { provide: SESSION_STORAGE, useValue: null },
      ],
    });
    const store = TestBed.inject(TripStore);
    // First in document order; the library list itself is sorted by recency.
    expect(store.splits()[0].id).toBe('new');
    TestBed.resetTestingModule();
  });
});

describe('multi-tab sync — no storage available', () => {
  it('does not attach a listener when there is nowhere to save', () => {
    TestBed.configureTestingModule({
      providers: [
        { provide: TRIP_STORAGE, useValue: null },
        { provide: SESSION_STORAGE, useValue: null },
      ],
    });
    const store = TestBed.inject(TripStore);

    otherTabWrites([splitOf('camping', 'x')]);

    expect(store.people().length).toBe(0);
    TestBed.resetTestingModule();
  });
});
