/**
 * The currency picker, exercised where it actually lives — the split's own
 * base currency and the expense sheet's own currency.
 *
 * Two things matter beyond the filtering itself: the closed box always reads
 * back what the model holds, and a query that was typed but never confirmed
 * changes nothing.
 *
 * Both pickers are mounted through the component that actually renders them
 * — {@link SplitGrid} for the base currency, {@link SheetEditor} for a
 * sheet's own — rather than through the whole app and its tabs, which have
 * nothing to do with what is under test here.
 */

import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TripStore } from '../core/trip-store';
import { SESSION_STORAGE, TRIP_STORAGE } from '../core/library-storage';
import { FakeStorage } from '../core/library-storage.spec';
import { SheetEditor } from './sheet-editor';
import { SplitGrid } from './split-grid';

/** Mounts the split header a base-currency change reaches through. */
function splitGrid(): { fixture: ComponentFixture<SplitGrid>; store: TripStore } {
  TestBed.configureTestingModule({
    imports: [SplitGrid],
    providers: [
      { provide: TRIP_STORAGE, useValue: new FakeStorage() },
      { provide: SESSION_STORAGE, useValue: new FakeStorage() },
    ],
  });

  const store = TestBed.inject(TripStore);
  const fixture = TestBed.createComponent(SplitGrid);
  fixture.detectChanges();
  return { fixture, store };
}

/** Mounts the panel a Sheet cell opens. */
function sheetEditor(): { fixture: ComponentFixture<SheetEditor>; store: TripStore } {
  TestBed.configureTestingModule({
    imports: [SheetEditor],
    providers: [
      { provide: TRIP_STORAGE, useValue: new FakeStorage() },
      { provide: SESSION_STORAGE, useValue: new FakeStorage() },
    ],
  });

  const store = TestBed.inject(TripStore);
  const fixture = TestBed.createComponent(SheetEditor);
  return { fixture, store };
}

function openOn(fixture: ComponentFixture<SheetEditor>, sheetId: string): void {
  fixture.componentRef.setInput('sheetId', sheetId);
  fixture.detectChanges();
}

type Fixture = ComponentFixture<unknown>;

function box(fixture: Fixture, scope: string): HTMLInputElement {
  return (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
    `${scope} .picker-input`,
  )!;
}

function options(fixture: Fixture, scope: string): string[] {
  return Array.from(
    (fixture.nativeElement as HTMLElement).querySelectorAll(`${scope} .picker-option`),
  ).map((li) =>
    // The code and the name are separate spans, laid out with a flex gap.
    Array.from(li.querySelectorAll('span'))
      .map((span) => span.textContent!.trim())
      .join(' '),
  );
}

function open(fixture: Fixture, input: HTMLInputElement): void {
  input.dispatchEvent(new MouseEvent('mousedown'));
  fixture.detectChanges();
}

function type(fixture: Fixture, input: HTMLInputElement, text: string): void {
  input.value = text;
  input.dispatchEvent(new Event('input'));
  fixture.detectChanges();
}

function press(fixture: Fixture, input: HTMLInputElement, key: string): void {
  input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  fixture.detectChanges();
}

describe('currency picker', () => {
  afterEach(() => TestBed.resetTestingModule());

  describe('base currency', () => {
    const scope = '.currency-select';

    it('shows the currency the split actually uses', () => {
      const { fixture, store } = splitGrid();

      // Anything but USD, which is first in the catalogue and would mask a bug.
      store.setBaseCurrency('EUR');
      fixture.detectChanges();

      expect(box(fixture, scope).value).toBe('(EUR) Euro');
    });

    it('opens on the whole catalogue with the current choice still readable', () => {
      const { fixture } = splitGrid();

      const input = box(fixture, scope);
      open(fixture, input);

      expect(input.value).toBe('');
      expect(input.placeholder).toBe('(USD) US Dollar');
      expect(options(fixture, scope).length).toBeGreaterThan(150);
    });

    it('finds a currency by name and takes it on Enter', () => {
      const { fixture, store } = splitGrid();

      const input = box(fixture, scope);
      open(fixture, input);
      type(fixture, input, 'forint');

      expect(options(fixture, scope)).toEqual(['HUF Hungarian Forint']);

      press(fixture, input, 'Enter');

      expect(store.baseCurrency()).toBe('HUF');
      expect(input.value).toBe('(HUF) Hungarian Forint');
      expect(options(fixture, scope)).toEqual([]);
    });

    it('finds a currency by code, with the exact code first', () => {
      const { fixture, store } = splitGrid();

      const input = box(fixture, scope);
      open(fixture, input);
      type(fixture, input, 'gbp');
      press(fixture, input, 'Enter');

      expect(store.baseCurrency()).toBe('GBP');
    });

    it('walks the list with the arrow keys', () => {
      const { fixture, store } = splitGrid();

      const input = box(fixture, scope);
      open(fixture, input);
      // Opens on USD, the current choice; one step down is EUR.
      press(fixture, input, 'ArrowDown');
      press(fixture, input, 'Enter');

      expect(store.baseCurrency()).toBe('EUR');
    });

    it('leaves the choice alone when the query is abandoned', () => {
      const { fixture, store } = splitGrid();

      const input = box(fixture, scope);
      open(fixture, input);
      type(fixture, input, 'forint');
      press(fixture, input, 'Escape');

      expect(store.baseCurrency()).toBe('USD');
      expect(input.value).toBe('(USD) US Dollar');

      // The same again, but walking away instead of pressing Escape.
      open(fixture, input);
      type(fixture, input, 'yen');
      input.dispatchEvent(new Event('blur'));
      fixture.detectChanges();

      expect(store.baseCurrency()).toBe('USD');
      expect(input.value).toBe('(USD) US Dollar');
    });

    it('says so when nothing matches', () => {
      const { fixture, store } = splitGrid();

      const input = box(fixture, scope);
      open(fixture, input);
      type(fixture, input, 'quatloo');

      expect(options(fixture, scope)).toEqual([]);
      expect(
        (fixture.nativeElement as HTMLElement).querySelector(`${scope} .picker-empty`),
      ).not.toBeNull();

      // Enter on nothing must not pick something at random.
      press(fixture, input, 'Enter');
      expect(store.baseCurrency()).toBe('USD');
    });
  });

  describe('sheet currency', () => {
    const scope = 'app-currency-picker';

    it('shows the currency the sheet actually uses', () => {
      const { fixture, store } = sheetEditor();

      store.setSheetCurrency(store.sheets()[0].id, 'HUF');
      openOn(fixture, store.sheets()[0].id);

      expect(box(fixture, scope).value).toBe('(HUF) Hungarian Forint');
    });

    it('offers the trip default alongside the catalogue', () => {
      const { fixture, store } = sheetEditor();

      store.setBaseCurrency('EUR');
      store.setSheetCurrency(store.sheets()[0].id, 'JPY');
      openOn(fixture, store.sheets()[0].id);

      const input = box(fixture, scope);
      open(fixture, input);

      expect(options(fixture, scope)[0]).toBe('Default (EUR)');

      type(fixture, input, 'default');
      press(fixture, input, 'Enter');

      expect(store.sheets()[0].currency).toBe('DEFAULT');
      expect(input.value).toBe('Default (EUR)');
    });

    it('takes a currency chosen with the mouse', () => {
      const { fixture, store } = sheetEditor();
      openOn(fixture, store.sheets()[0].id);

      const input = box(fixture, scope);
      open(fixture, input);
      type(fixture, input, 'thai baht');

      const option = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
        `${scope} .picker-option`,
      )!;
      option.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      fixture.detectChanges();

      expect(store.sheets()[0].currency).toBe('THB');
    });
  });
});
