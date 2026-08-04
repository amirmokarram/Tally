/**
 * The ledger grid, as the round trip it replaced.
 *
 * People, sheets and shares used to be three tabs; typing a share here has to
 * move the balances without leaving the grid, and adding a person has to grow a
 * column. Those two are the whole point of the merge, so they are what is
 * asserted — not the rendering, which is AG Grid's problem.
 */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { AgGridAngular } from 'ag-grid-angular';
import { GridApi } from 'ag-grid-community';

import { SplitGrid } from './split-grid';
import { TripStore } from '../core/trip-store';
import { SESSION_STORAGE, TRIP_STORAGE } from '../core/library-storage';
import { FakeStorage } from '../core/library-storage.spec';

interface Harness {
  fixture: ComponentFixture<SplitGrid>;
  store: TripStore;
  api: GridApi;
}

/**
 * Flushes a change through to the grid.
 *
 * Deliberately *not* `whenStable()`: AG Grid keeps timers of its own running
 * inside the Angular zone, so the zone is intermittently never stable and the
 * await hangs until Jasmine's 5s timeout kills the spec. A macrotask is both
 * enough — it is where AG Grid applies new column definitions — and reliable.
 */
async function settle(fixture: ComponentFixture<SplitGrid>): Promise<void> {
  fixture.detectChanges();
  await new Promise((resolve) => setTimeout(resolve));
  fixture.detectChanges();
}

async function grid(): Promise<Harness> {
  TestBed.configureTestingModule({
    imports: [SplitGrid],
    providers: [
      { provide: TRIP_STORAGE, useValue: new FakeStorage() },
      { provide: SESSION_STORAGE, useValue: new FakeStorage() },
    ],
  });

  const store = TestBed.inject(TripStore);
  store.loadSample('restaurant');

  const fixture = TestBed.createComponent(SplitGrid);
  await settle(fixture);

  const api = fixture.debugElement.query(By.directive(AgGridAngular))
    .componentInstance.api as GridApi;

  return { fixture, store, api };
}

function columnIds(api: GridApi): string[] {
  return (api.getColumns() ?? []).map((column) => column.getColId());
}

describe('the ledger grid', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('gives every person a column, in the order the store holds them', async () => {
    const { store, api } = await grid();

    expect(columnIds(api).filter((id) => id.startsWith('person:'))).toEqual(
      store.people().map((p) => `person:${p.id}`),
    );
  });

  it('adds a person and a sheet from the toolbar above the grid', async () => {
    const { fixture, store, api } = await grid();
    const people = store.people().length;
    const sheets = store.sheets().length;

    const buttons = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>(
        '.toolbar button',
      ),
    );

    // Neither has a home inside the grid any more: the person column and the
    // add-sheet row were both removed to give the ledger its space back.
    buttons.find((b) => b.textContent!.includes('person'))!.click();
    buttons.find((b) => b.textContent!.includes('sheet'))!.click();
    await settle(fixture);

    expect(store.people().length).toBe(people + 1);
    expect(store.sheets().length).toBe(sheets + 1);
    expect(columnIds(api)).toContain(`person:${store.people().at(-1)!.id}`);
    expect(columnIds(api)).not.toContain('add-person');
  });

  it('grows a column when a person is added and drops it when removed', async () => {
    const { fixture, store, api } = await grid();
    const before = store.people().length;

    const added = store.addPerson('Wednesday');
    await settle(fixture);

    expect(columnIds(api).filter((id) => id.startsWith('person:')).length).toBe(before + 1);
    expect(columnIds(api)).toContain(`person:${added.id}`);

    store.removePerson(added.id);
    await settle(fixture);

    expect(columnIds(api)).not.toContain(`person:${added.id}`);
  });

  it('moves the balances when a share is typed into a cell', async () => {
    const { fixture, store, api } = await grid();

    const person = store.people()[0];
    const item = store.sheets()[0].items[0];
    const before = store.balances().find((b) => b.personId === person.id)!.balance;

    store.clearItemShares(item.id);
    await settle(fixture);

    // The round trip the three tabs used to make you walk: edit here, and the
    // figure the Settle up tab reads changes.
    const node = api.getRowNode(`item:${item.id}`)!;
    node.setDataValue(`person:${person.id}`, 1);

    const after = store.balances().find((b) => b.personId === person.id)!.balance;
    expect(after).not.toBe(before);
    expect(store.share(item.id, person.id)).toEqual({ owe: 1, pay: 0 });
  });

  it('refuses a share outside the workbook’s 0 – 10 validation', async () => {
    const { store, api } = await grid();

    const person = store.people()[0];
    const item = store.sheets()[0].items[0];
    const before = store.share(item.id, person.id);

    api.getRowNode(`item:${item.id}`)!.setDataValue(`person:${person.id}`, 11);

    expect(store.share(item.id, person.id)).toEqual(before);
  });

  it('adds an item when the blank row under a sheet is typed into', async () => {
    const { store, api } = await grid();

    const sheet = store.sheets()[0];
    const before = sheet.items.length;

    api.getRowNode(`add-item:${sheet.id}`)!.setDataValue('item', 'Digestif');

    const items = store.sheets()[0].items;
    expect(items.length).toBe(before + 1);
    expect(items.at(-1)!.name).toBe('Digestif');
  });

  it('carries the trip total under the Amount column, and keeps it current', async () => {
    const { fixture, store, api } = await grid();

    const totalRow = api.getPinnedBottomRow(0)!;
    const amount = api.getColumn('amount')!;
    expect(api.getCellValue({ rowNode: totalRow, colKey: amount })).toBe(store.grandTotal());

    // There is no Line total column any more, so this row is the only place the
    // trip total appears in the grid — it has to follow an edit.
    const item = store.sheets()[0].items[0];
    api.getRowNode(`item:${item.id}`)!.setDataValue('amount', 1234.5);
    await settle(fixture);

    expect(api.getCellValue({ rowNode: api.getPinnedBottomRow(0)!, colKey: amount })).toBe(
      store.grandTotal(),
    );
  });

  it('leaves the blank row alone when nothing is typed', async () => {
    const { store, api } = await grid();

    const sheet = store.sheets()[0];
    const before = sheet.items.length;

    api.getRowNode(`add-item:${sheet.id}`)!.setDataValue('item', '   ');

    expect(store.sheets()[0].items.length).toBe(before);
  });
});
