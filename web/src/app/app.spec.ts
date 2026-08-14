import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { App } from './app';
import { routes } from './app.routes';
import { TripStore } from './core/trip-store';
import {
  APP_MARKER,
  SCHEMA_VERSION,
  SESSION_STORAGE,
  STORAGE_KEY,
  TRIP_STORAGE,
} from './core/library-storage';
import { FakeStorage } from './core/library-storage.spec';
import { newSavedSplit } from './models/library.model';
import { buildSampleTrip } from './data/sample-trips';

/**
 * The suite provides its own storage rather than the browser's, so tests
 * neither read each other's leftovers nor the developer's own saved splits.
 */
function configure(storage: Storage | null) {
  TestBed.configureTestingModule({
    imports: [App],
    providers: [
      { provide: TRIP_STORAGE, useValue: storage },
      { provide: SESSION_STORAGE, useValue: null },
      provideRouter(routes),
    ],
  });
}

/** Creates the app and drives the router to `url`, as a real navigation would. */
async function createAndNavigate(url = '/') {
  const fixture = TestBed.createComponent(App);
  await TestBed.inject(Router).navigateByUrl(url);
  fixture.detectChanges();
  return fixture;
}

describe('App', () => {
  it('creates the app', async () => {
    configure(null);
    const fixture = await createAndNavigate();
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('opens on the help tab so a first-time user is not staring at an empty grid', async () => {
    configure(null);
    const fixture = await createAndNavigate();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('app-help-panel')).toBeTruthy();
  });
});

describe('App — resuming a saved split', () => {
  it('restores the library and opens on the split grid', async () => {
    const storage = new FakeStorage();
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        app: APP_MARKER,
        version: SCHEMA_VERSION,
        savedAt: new Date().toISOString(),
        splits: [newSavedSplit(buildSampleTrip('restaurant'), 'a')],
      }),
    );

    configure(storage);
    const fixture = await createAndNavigate();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(TestBed.inject(TripStore).restoredFromStorage).toBe(true);
    expect(compiled.querySelector('app-split-grid')).toBeTruthy();
  });

  it('writes every edit straight back to storage', async () => {
    const storage = new FakeStorage();
    configure(storage);
    const fixture = await createAndNavigate();

    const store = TestBed.inject(TripStore);
    store.setTitle('Weekend in Lisbon');
    store.addPerson('Ana');
    fixture.detectChanges();

    const saved = JSON.parse(storage.getItem(STORAGE_KEY)!);
    expect(saved.version).toBe(SCHEMA_VERSION);
    expect(saved.splits[0].trip.title).toBe('Weekend in Lisbon');
    expect(saved.splits[0].trip.people[0].name).toBe('Ana');
  });

  it('ignores a saved library it cannot read and starts clean', async () => {
    const storage = new FakeStorage();
    storage.setItem(STORAGE_KEY, '{"version":2,"splits":"corrupt"}');

    configure(storage);
    const fixture = await createAndNavigate();

    const store = TestBed.inject(TripStore);
    expect(store.restoredFromStorage).toBe(false);
    expect(store.people().length).toBe(0);
    expect((fixture.nativeElement as HTMLElement).querySelector('app-help-panel')).toBeTruthy();
  });

  it('lists every saved split on the Splits tab', async () => {
    const storage = new FakeStorage();
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        app: APP_MARKER,
        version: SCHEMA_VERSION,
        splits: [
          newSavedSplit(buildSampleTrip('restaurant'), 'a', '2026-08-01T00:00:00.000Z'),
          newSavedSplit(buildSampleTrip('camping'), 'b', '2026-08-02T00:00:00.000Z'),
        ],
      }),
    );

    configure(storage);
    const fixture = await createAndNavigate('/splits');

    const titles = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll('app-splits-panel .title'),
    ].map((el) => el.textContent!.trim());

    // Most recently edited first.
    expect(titles[0]).toContain('Camping');
    expect(titles[1]).toContain('Cheesecake Factory');
  });
});

/**
 * The Split tab wears a badge for open problems — the split's own name,
 * currency and actions moved down to that tab's own page, so nothing about
 * the tab bar itself is folded away at any width any more.
 */
describe('App — the Split tab’s error badge', () => {
  async function start() {
    configure(null);
    const fixture = await createAndNavigate();
    const query = <T extends HTMLElement>(selector: string) =>
      (fixture.nativeElement as HTMLElement).querySelector<T>(selector);
    return { fixture, query };
  }

  it('shows the count of open problems', async () => {
    const { query } = await start();

    // A split with nobody on it is an error, and the tab has to say so.
    expect(TestBed.inject(TripStore).issues().some((i) => i.severity === 'error')).toBe(true);
    expect(query('.tabs .badge')!.textContent!.trim()).toBe('1');
  });

  it('drops the badge once there is nothing wrong', async () => {
    const { fixture, query } = await start();

    TestBed.inject(TripStore).addPerson('Sarah');
    fixture.detectChanges();

    expect(query('.tabs .badge')).toBeNull();
  });
});
