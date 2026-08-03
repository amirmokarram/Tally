import { TestBed } from '@angular/core/testing';

import { App } from './app';
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
    ],
  });
}

describe('App', () => {
  it('creates the app', () => {
    configure(null);
    expect(TestBed.createComponent(App).componentInstance).toBeTruthy();
  });

  it('opens on the help tab so a first-time user is not staring at an empty grid', () => {
    configure(null);
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('app-help-panel')).toBeTruthy();
  });

  it('shows the running total from the store', () => {
    configure(null);
    const fixture = TestBed.createComponent(App);
    TestBed.inject(TripStore).loadSample('restaurant');
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.total .value')?.textContent).toContain('109.23');
  });

  it('says so when the browser will not let it save', () => {
    configure(null);
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const footer = (fixture.nativeElement as HTMLElement).querySelector('footer');
    expect(footer?.textContent).toContain('will not let the app save');
  });
});

describe('App — resuming a saved split', () => {
  it('restores the library and opens on the split grid', () => {
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
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(TestBed.inject(TripStore).restoredFromStorage).toBe(true);
    expect(compiled.querySelector('app-split-grid')).toBeTruthy();
    expect(compiled.querySelector('.total .value')?.textContent).toContain('109.23');
    expect(compiled.querySelector('footer')?.textContent).toContain('Saved automatically');
  });

  it('writes every edit straight back to storage', () => {
    const storage = new FakeStorage();
    configure(storage);
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const store = TestBed.inject(TripStore);
    store.setTitle('Weekend in Lisbon');
    store.addPerson('Ana');
    fixture.detectChanges();

    const saved = JSON.parse(storage.getItem(STORAGE_KEY)!);
    expect(saved.version).toBe(SCHEMA_VERSION);
    expect(saved.splits[0].trip.title).toBe('Weekend in Lisbon');
    expect(saved.splits[0].trip.people[0].name).toBe('Ana');
  });

  it('ignores a saved library it cannot read and starts clean', () => {
    const storage = new FakeStorage();
    storage.setItem(STORAGE_KEY, '{"version":2,"splits":"corrupt"}');

    configure(storage);
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const store = TestBed.inject(TripStore);
    expect(store.restoredFromStorage).toBe(false);
    expect(store.people().length).toBe(0);
    expect((fixture.nativeElement as HTMLElement).querySelector('app-help-panel')).toBeTruthy();
  });

  it('lists every saved split on the Splits tab', () => {
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
    const fixture = TestBed.createComponent(App);
    const component = fixture.componentInstance as unknown as { tab: { set(v: string): void } };
    component.tab.set('splits');
    fixture.detectChanges();

    const titles = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll('app-splits-panel .title'),
    ].map((el) => el.textContent!.trim());

    // Most recently edited first.
    expect(titles[0]).toContain('Camping');
    expect(titles[1]).toContain('Cheesecake Factory');
  });
});

/**
 * Below the breakpoint in `app.scss` the tabs, the currency picker and the
 * export actions fold behind one button. The stylesheet decides *whether* any
 * of that is on screen; these tests cover what can go wrong at any width — the
 * open/closed state, and the badge that would otherwise be folded away with
 * the tab it belongs to.
 */
describe('App — the phone menu', () => {
  function start() {
    configure(null);
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const query = <T extends HTMLElement>(selector: string) =>
      (fixture.nativeElement as HTMLElement).querySelector<T>(selector);
    return { fixture, query, toggle: () => query<HTMLButtonElement>('.menu-toggle')! };
  }

  it('starts closed', () => {
    const { query, toggle } = start();

    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(query('.topbar')!.classList).not.toContain('menu-open');
  });

  it('opens and closes from the button', () => {
    const { fixture, query, toggle } = start();

    toggle().click();
    fixture.detectChanges();

    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(toggle().getAttribute('aria-label')).toBe('Close menu');
    expect(query('.topbar')!.classList).toContain('menu-open');

    toggle().click();
    fixture.detectChanges();

    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(toggle().getAttribute('aria-label')).toBe('Menu');
    expect(query('.topbar')!.classList).not.toContain('menu-open');
  });

  it('points at the navigation it reveals', () => {
    const { query, toggle } = start();

    expect(query(`#${toggle().getAttribute('aria-controls')}`)).toBe(query('.tabs'));
  });

  it('closes once a tab is chosen', () => {
    const { fixture, query, toggle } = start();
    toggle().click();
    fixture.detectChanges();

    query<HTMLButtonElement>('.tab')!.click();
    fixture.detectChanges();

    expect(toggle().getAttribute('aria-expanded')).toBe('false');
  });

  it('closes when a new split moves the user to another tab', () => {
    const { fixture, toggle } = start();
    toggle().click();
    fixture.detectChanges();

    const buttons = [...(fixture.nativeElement as HTMLElement).querySelectorAll('.actions .btn')];
    (buttons.find((b) => b.textContent!.includes('New split')) as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect((fixture.nativeElement as HTMLElement).querySelector('app-people-panel')).toBeTruthy();
  });

  it('carries the error count while the Split tab is folded away', () => {
    const { fixture, query, toggle } = start();

    // A split with nobody on it is an error, and the button has to say so —
    // the tab wearing that badge is behind it.
    expect(TestBed.inject(TripStore).issues().some((i) => i.severity === 'error')).toBe(true);
    expect(query('.menu-toggle .badge')!.textContent!.trim()).toBe('1');

    toggle().click();
    fixture.detectChanges();

    // Open, the Split tab is on screen carrying its own badge, so the button
    // no longer stands in for it.
    expect(query('.menu-toggle .badge')).toBeNull();
    expect(query('.tabs .badge')).not.toBeNull();
  });

  it('drops the badge once there is nothing wrong', () => {
    const { fixture, query } = start();

    TestBed.inject(TripStore).addPerson('Sarah');
    fixture.detectChanges();

    expect(query('.menu-toggle .badge')).toBeNull();
  });

  /**
   * The splits panel reaches for the import input by template reference and
   * clicks it. Inside `.actions` it would sit in a `display: none` subtree
   * whenever the menu is closed, which is a fragile thing to click.
   */
  it('keeps the import input out of the group it folds away', () => {
    const { query } = start();
    const input = query('input[type="file"]')!;

    expect(input.closest('.actions')).toBeNull();
    expect(input.closest('.identity')).not.toBeNull();
  });
});
