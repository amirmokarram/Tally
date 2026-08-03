/**
 * The split grid drops its columns on a phone and becomes one card per sheet
 * (see the media query in `split-grid.ts`). A column carries the person's name
 * in its header; a card has to carry it on every box, or the figures lose the
 * only thing that says whose they are.
 *
 * The stylesheet cannot be tested here, but the hooks it hangs on can — and
 * they are invisible on a desktop screen, which is exactly how they would rot.
 */

import { TestBed } from '@angular/core/testing';

import { App } from '../app';
import { TripStore } from '../core/trip-store';
import { SESSION_STORAGE, TRIP_STORAGE } from '../core/library-storage';
import { FakeStorage } from '../core/library-storage.spec';

function splitTab() {
  TestBed.configureTestingModule({
    imports: [App],
    providers: [
      { provide: TRIP_STORAGE, useValue: new FakeStorage() },
      { provide: SESSION_STORAGE, useValue: new FakeStorage() },
    ],
  });

  const fixture = TestBed.createComponent(App);
  const store = TestBed.inject(TripStore);
  store.loadSample('restaurant');
  (fixture.componentInstance as unknown as { tab: { set(v: string): void } }).tab.set('split');
  fixture.detectChanges();

  const grid = (fixture.nativeElement as HTMLElement).querySelector('app-split-grid')!;
  return { fixture, store, grid };
}

describe('the split grid, as cards', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('names the person on every share box, not just in the column header', () => {
    const { store, grid } = splitTab();
    const names = store.people().map((p) => p.name);

    expect(names.length).toBeGreaterThan(1);

    for (const row of grid.querySelectorAll('tbody tr')) {
      const labels = [...row.querySelectorAll('.share-cell')].map((cell) =>
        cell.getAttribute('data-person'),
      );
      expect(labels).toEqual(names);
    }
  });

  it('names the person on every balance, not just in the column header', () => {
    const { store, grid } = splitTab();

    const named = [...grid.querySelectorAll('.balance-row .person-col')].map((th) => ({
      name: th.querySelector('.person-name')!.textContent!.trim(),
      amount: th.querySelector('.balance-amount')!.textContent!.trim(),
    }));

    expect(named.map((b) => b.name)).toEqual(store.people().map((p) => p.name));
    expect(named.every((b) => b.amount.length > 0)).toBe(true);
  });

  it('keeps the column headers the wide layout reads from', () => {
    const { store, grid } = splitTab();

    const headers = [...grid.querySelectorAll('thead tr:not(.balance-row) .person-col')].map(
      (th) => th.textContent!.trim(),
    );

    expect(headers).toEqual(store.people().map((p) => p.name));
  });

  /**
   * The card labels are CSS-generated content, so the accessible name has to
   * come from the input itself either way.
   */
  it('leaves each share input able to say what it is on its own', () => {
    const { grid } = splitTab();
    const input = grid.querySelector('tbody tr .share-cell .share-input')!;

    expect(input.getAttribute('aria-label')).toMatch(/ share of /);
  });

  it('keeps the item name in a cell of its own so the card can place it', () => {
    const { grid } = splitTab();
    const first = grid.querySelector('tbody tr')!;

    expect(first.querySelector('.item-cell')!.textContent!.trim().length).toBeGreaterThan(0);
    expect(first.querySelector('.sheet-cell')).not.toBeNull();
  });
});
