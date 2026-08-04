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
import { LEDGER_ROW_HEIGHT } from './grid-theme';
import { TripStore } from '../core/trip-store';
import { SESSION_STORAGE, TRIP_STORAGE } from '../core/library-storage';
import { FakeStorage } from '../core/library-storage.spec';

interface Harness {
  fixture: ComponentFixture<SplitGrid>;
  store: TripStore;
  api: GridApi;
}

/**
 * The selection handlers, which are `protected` so the template can reach them.
 *
 * They are driven directly rather than through a real drag: whether a pointer
 * on a cell becomes a `cellMouseDown` is AG Grid's business, and simulating it
 * would test their plumbing instead of this component's rectangle.
 */
interface Selecting {
  onCellMouseDown(event: unknown): void;
  onCellMouseOver(event: unknown): void;
}

function selecting(fixture: ComponentFixture<SplitGrid>): Selecting {
  return fixture.componentInstance as unknown as Selecting;
}

/**
 * Stands in for the cell event AG Grid hands the two mouse handlers. The pinned
 * strip is fetched separately — `getRowNode` only knows rows that scroll.
 */
function onCell(api: GridApi, rowId: string, colId: string, shiftKey = false): unknown {
  return {
    node: rowId === 'balances' ? api.getPinnedTopRow(0) : api.getRowNode(rowId),
    column: { getColId: () => colId },
    event: new MouseEvent('mousedown', { shiftKey }),
  };
}

/** Drags from one cell to another, the way a pointer would. */
function drag(harness: Harness, from: [string, string], to: [string, string]): void {
  const grid = selecting(harness.fixture);
  grid.onCellMouseDown(onCell(harness.api, ...from));
  grid.onCellMouseOver(onCell(harness.api, ...to));
}

/** Ticks the given lines, the way their check boxes would. */
function tick(harness: Harness, items: readonly { id: string }[]): void {
  harness.api.setNodesSelected({
    nodes: items.map((item) => harness.api.getRowNode(`item:${item.id}`)!),
    newValue: true,
  });
}

/** A row action from the toolbar, or null while it is not being offered. */
function toolbarButton(
  fixture: ComponentFixture<SplitGrid>,
  label: string,
): HTMLButtonElement | null {
  return (
    Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>(
        '.toolbar button',
      ),
    ).find((button) => button.textContent!.trim().startsWith(label)) ?? null
  );
}

function clipboardEvent(type: 'copy' | 'paste', text?: string): ClipboardEvent {
  const clipboardData = new DataTransfer();
  if (text !== undefined) {
    clipboardData.setData('text/plain', text);
  }
  return new ClipboardEvent(type, { clipboardData, bubbles: true, cancelable: true });
}

/** What the grid puts on the clipboard for the block currently selected. */
function copyFrom(fixture: ComponentFixture<SplitGrid>): string {
  const event = clipboardEvent('copy');
  fixture.nativeElement.dispatchEvent(event);
  return event.clipboardData!.getData('text/plain');
}

function pasteInto(fixture: ComponentFixture<SplitGrid>, text: string): void {
  fixture.nativeElement.dispatchEvent(clipboardEvent('paste', text));
}

function selectedCells(fixture: ComponentFixture<SplitGrid>): string[] {
  return Array.from(
    (fixture.nativeElement as HTMLElement).querySelectorAll('.ledger-selected'),
  ).map(
    (cell) =>
      `${cell.closest('.ag-row')!.getAttribute('row-id')}/${cell.getAttribute('col-id')}`,
  );
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
  // Twice. The first macrotask is where `onGridReady` re-applies the column
  // definitions, which is what makes AG Grid resolve the Angular cell renderers
  // at all; the second is where the cells they render reach the DOM. Settling
  // once left every test that reads a rendered cell winning a race.
  await settle(fixture);
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

  it('adds a person from the toolbar above the grid', async () => {
    const { fixture, store, api } = await grid();
    const people = store.people().length;

    // The person column has no home inside the grid: it was removed to give the
    // ledger its space back, and the button that makes one went with it.
    const button = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>(
        '.toolbar button',
      ),
    ).find((b) => b.textContent!.includes('person'))!;
    button.click();
    await settle(fixture);

    expect(store.people().length).toBe(people + 1);
    expect(columnIds(api)).toContain(`person:${store.people().at(-1)!.id}`);
    expect(columnIds(api)).not.toContain('add-person');
  });

  it('adds a sheet from the button at the head of the Sheet column', async () => {
    const { fixture, store } = await grid();
    const sheets = store.sheets().length;

    const button = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      '.ag-header-cell[col-id="sheet"] button[aria-label="Add expense sheet"]',
    );
    expect(button).withContext('the add-sheet button in the Sheet header').not.toBeNull();

    button!.click();
    await settle(fixture);

    expect(store.sheets().length).toBe(sheets + 1);
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

  it('keeps Enter in a person’s name box away from the grid', async () => {
    const { fixture, store } = await grid();

    const header = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
      `.ag-header-cell[col-id="person:${store.people()[0].id}"]`,
    )!;
    const input = header.querySelector('input.name')!;

    let reachedGrid = false;
    header.addEventListener('keydown', () => (reachedGrid = true));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await settle(fixture);

    // Enter blurs the box, which clears the header AG Grid thinks is focused —
    // and AG Grid reads that back, unguarded, on any keydown reaching the
    // header cell. Letting this one through is a TypeError in the console.
    expect(reachedGrid).toBe(false);
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

  /**
   * Ticking lines and acting on all of them at once — what replaced the three
   * buttons that used to sit on every row in a column of their own.
   */
  describe('the ticked lines', () => {
    it('removes every ticked line, and takes its shares with it', async () => {
      const harness = await grid();
      const items = harness.store.sheets()[0].items;
      const person = harness.store.people()[0];
      const doomed = [items[1], items[2]];
      const before = harness.store.balances().find((b) => b.personId === person.id)!.balance;

      tick(harness, doomed);
      await settle(harness.fixture);

      expect(toolbarButton(harness.fixture, 'Remove')!.textContent).toContain('2 lines');
      toolbarButton(harness.fixture, 'Remove')!.click();
      await settle(harness.fixture);

      expect(harness.store.sheets()[0].items.map((i) => i.id)).toEqual([
        items[0].id,
        items[3].id,
        items[4].id,
      ]);
      // Gone from the split, so the balances have to have moved with them.
      expect(harness.store.share(doomed[0].id, person.id)).toEqual({ owe: 0, pay: 0 });
      expect(
        harness.store.balances().find((b) => b.personId === person.id)!.balance,
      ).not.toBe(before);
    });

    it('gives everyone a share of the ticked lines, and clears them again', async () => {
      const harness = await grid();
      const items = harness.store.sheets()[0].items;
      const people = harness.store.people();

      tick(harness, [items[0]]);
      await settle(harness.fixture);
      toolbarButton(harness.fixture, 'Everyone')!.click();
      await settle(harness.fixture);

      for (const person of people) {
        expect(harness.store.share(items[0].id, person.id).owe).toBe(1);
      }

      toolbarButton(harness.fixture, 'Clear shares')!.click();
      await settle(harness.fixture);

      for (const person of people) {
        expect(harness.store.share(items[0].id, person.id)).toEqual({ owe: 0, pay: 0 });
      }
    });

    it('offers nothing while nothing is ticked', async () => {
      const { fixture } = await grid();

      // The buttons reserve no space until they have something to act on.
      expect(toolbarButton(fixture, 'Remove')).toBeNull();
      expect(toolbarButton(fixture, 'Everyone')).toBeNull();
    });

    it('will not tick the blank row that ends a block, or the pinned strip', async () => {
      const { fixture, api, store } = await grid();
      const sheet = store.sheets()[0];
      const host = fixture.nativeElement as HTMLElement;

      expect(api.getRowNode(`add-item:${sheet.id}`)!.selectable).toBe(false);
      expect(api.getRowNode(`item:${sheet.items[0].id}`)!.selectable).toBe(true);

      // No box at all on those rows — one that cannot be ticked is worse than
      // none. The pinned strip never goes through `isRowSelectable`, so the
      // cell has to rule it out itself.
      expect(host.querySelectorAll('.ag-row[row-id^="add-item:"] [col-id="select"] input').length)
        .toBe(0);
      expect(host.querySelectorAll('.ag-row-pinned [col-id="select"] input').length).toBe(0);
      expect(
        host.querySelectorAll('.ag-row[row-id^="item:"] [col-id="select"] input').length,
      ).toBeGreaterThan(0);
    });

    it('ticks a line from its own box, and every line from the header', async () => {
      const { fixture, store } = await grid();
      const host = fixture.nativeElement as HTMLElement;
      const boxes = () =>
        Array.from(
          host.querySelectorAll<HTMLInputElement>(
            '.ag-row[row-id^="item:"] [col-id="select"] input',
          ),
        );
      const header = () =>
        host.querySelector<HTMLInputElement>('.ag-header-cell[col-id="select"] input')!;

      boxes()[0].click();
      await settle(fixture);
      expect(boxes().filter((b) => b.checked).length).toBe(1);
      // Some but not all: the header says so rather than claiming either.
      expect(header().indeterminate).toBe(true);

      header().click();
      await settle(fixture);
      expect(boxes().every((b) => b.checked)).toBe(true);
      expect(header().checked).toBe(true);
      expect(toolbarButton(fixture, 'Remove')!.textContent).toContain(
        `${store.sheets()[0].items.length} lines`,
      );

      header().click();
      await settle(fixture);
      expect(boxes().some((b) => b.checked)).toBe(false);
      expect(toolbarButton(fixture, 'Remove')).toBeNull();
    });
  });

  /**
   * Money reads as money and edits as a number. Shares are left alone: they are
   * ratios, and a currency symbol on one would be a lie about what it means.
   */
  describe('the money cells', () => {
    function text(fixture: ComponentFixture<SplitGrid>, rowId: string, colId: string): string {
      return (fixture.nativeElement as HTMLElement)
        .querySelector(`.ag-row[row-id="${rowId}"] [col-id="${colId}"]`)!
        .textContent!.trim();
    }

    function pinned(fixture: ComponentFixture<SplitGrid>, colId: string): string {
      return (fixture.nativeElement as HTMLElement)
        .querySelector(`.ag-row-pinned [col-id="${colId}"]`)!
        .textContent!.trim();
    }

    it('shows a person’s balance the way it shows the trip total', async () => {
      const { fixture, store } = await grid();
      const person = store.people()[0];

      // Both carry the symbol; both put a credit in parentheses rather than
      // behind a minus sign, the way the workbook showed someone who is owed.
      expect(pinned(fixture, 'amount')).toMatch(/^\$[\d,]+\.\d\d$/);
      expect(pinned(fixture, `person:${person.id}`)).toMatch(/^\(?\$[\d,]+\.\d\d\)?$/);
    });

    it('leaves a share cell as the ratio it is', async () => {
      const { fixture, store } = await grid();
      const item = store.sheets()[0].items[0];
      const person = store.people()[0];

      expect(text(fixture, `item:${item.id}`, `person:${person.id}`)).toBe('1');
    });

    it('draws an amount as money and hands the editor the plain number', async () => {
      const { fixture, api, store } = await grid();
      const item = store.sheets()[0].items[0];
      const rowId = `item:${item.id}`;

      expect(text(fixture, rowId, 'amount')).toBe('$15.00');
      // The value itself never became a string — only the drawing of it.
      expect(
        api.getCellValue({ rowNode: api.getRowNode(rowId)!, colKey: api.getColumn('amount')! }),
      ).toBe(15);

      api.startEditingCell({ rowIndex: 0, colKey: 'amount' });
      await settle(fixture);

      const editor = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
        '.ag-cell-inline-editing input',
      )!;
      expect(editor.value).toBe('15');
    });

    it('draws an amount in its own sheet’s currency, not the trip’s', async () => {
      const { fixture, store } = await grid();
      const sheet = store.sheets()[0];
      const rowId = `item:${sheet.items[0].id}`;

      store.setSheetCurrency(sheet.id, 'EUR');
      await settle(fixture);

      expect(text(fixture, rowId, 'amount')).toBe('€15.00');
      // The trip total stays in the trip's currency — it is a different sum.
      expect(pinned(fixture, 'amount').startsWith('$')).toBe(true);
    });

    it('copies the number, not the way it is drawn', async () => {
      const harness = await grid();
      const item = harness.store.sheets()[0].items[0];

      drag(harness, [`item:${item.id}`, 'amount'], [`item:${item.id}`, 'amount']);

      // Otherwise a copy and a paste straight back would not survive the trip.
      expect(copyFrom(harness.fixture)).toBe('15');
    });
  });

  /**
   * The sheet's own settings, in its cell. Everything here used to need the
   * panel; the panel is still the long form, but naming a sheet and charging it
   * are now boxes in the block heading, like a person's name in their header.
   */
  describe('the sheet cell', () => {
    function sheetCell(fixture: ComponentFixture<SplitGrid>): HTMLElement {
      return (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
        '.ag-spanned-cell app-sheet-cell',
      )!;
    }

    function chargeBox(fixture: ComponentFixture<SplitGrid>, at: number): HTMLInputElement {
      return sheetCell(fixture).querySelectorAll<HTMLInputElement>('.charges input')[at];
    }

    it('renames the sheet as the name is typed, without opening anything', async () => {
      const { fixture, store } = await grid();

      const name = sheetCell(fixture).querySelector<HTMLInputElement>('input.name')!;
      expect(name.value).toBe(store.sheets()[0].name);

      name.value = 'Dinner';
      name.dispatchEvent(new Event('input'));
      await settle(fixture);

      expect(store.sheets()[0].name).toBe('Dinner');
      expect((fixture.nativeElement as HTMLElement).querySelector('app-sheet-editor')).toBeNull();
    });

    it('takes a charge as an amount or as a percentage', async () => {
      const { fixture, store } = await grid();
      const sheetId = store.sheets()[0].id;

      chargeBox(fixture, 0).value = '4.25';
      chargeBox(fixture, 0).dispatchEvent(new Event('change'));
      chargeBox(fixture, 1).value = '20%';
      chargeBox(fixture, 1).dispatchEvent(new Event('change'));
      await settle(fixture);

      const sheet = store.sheets().find((s) => s.id === sheetId)!;
      expect(sheet.tax).toEqual({ value: 4.25, isPercent: false });
      // The trailing % is the whole switch between the two.
      expect(sheet.tip).toEqual({ value: 0.2, isPercent: true });
    });

    it('keeps what was there when a charge will not parse', async () => {
      const { fixture, store } = await grid();
      const before = store.sheets()[0].tax;

      const box = chargeBox(fixture, 0);
      box.value = 'about five';
      box.dispatchEvent(new Event('change'));
      await settle(fixture);

      expect(store.sheets()[0].tax).toEqual(before);
      // And the box says so, rather than sitting on a figure that was refused.
      expect(box.value).toBe(before.value ? String(before.value) : '');
    });

    it('offers no charges on a sheet with no lines to spread them over', async () => {
      const { fixture, store } = await grid();
      const empty = store.addSheet('Nothing yet');
      await settle(fixture);

      const cell = Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll('app-sheet-cell'),
      ).find(
        (c) => c.querySelector<HTMLInputElement>('input.name')?.value === empty.name,
      )!;
      expect(cell).toBeTruthy();
      expect(cell.querySelectorAll('.charges input').length).toBe(0);
      // The name is still editable — that is the one thing it can have.
      expect(cell.querySelector('input.name')).not.toBeNull();
    });
  });

  it('numbers each line within its own sheet', async () => {
    const { api, store } = await grid();
    const sheet = store.sheets()[0];
    const index = api.getColumn('index')!;

    const numbers = sheet.items.map((item) =>
      api.getCellValue({ rowNode: api.getRowNode(`item:${item.id}`)!, colKey: index }),
    );
    expect(numbers).toEqual([1, 2, 3, 4, 5]);

    // The blank row that ends the block is not a line, so it has no number.
    expect(
      api.getCellValue({ rowNode: api.getRowNode(`add-item:${sheet.id}`)!, colKey: index }),
    ).toBe('');
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

  /**
   * The one piece of rendering this file does assert, because it is the one
   * piece the app draws itself: AG Grid sizes a spanned cell when it builds it
   * and never again, so without `sheet-cell.ts` re-applying the height a sheet
   * that grows leaves its new lines outside the merged block.
   */
  it('grows a sheet’s merged cell when a line is added to it', async () => {
    const { fixture, store, api } = await grid();

    const sheet = store.sheets()[0];
    const merged = () =>
      (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.ag-spanned-cell')!;

    // Five items and the "add" line under them.
    expect(merged().style.height).toBe(`${6 * LEDGER_ROW_HEIGHT - 1}px`);

    api.getRowNode(`add-item:${sheet.id}`)!.setDataValue('item', 'Digestif');
    await settle(fixture);

    expect(merged().style.height).toBe(`${7 * LEDGER_ROW_HEIGHT - 1}px`);
  });

  it('carries the trip total on the pinned strip, beside the balances', async () => {
    const { fixture, store, api } = await grid();

    // One summary row, not two: the total sits under the Amount header exactly
    // as each person's balance sits under theirs.
    expect(api.getPinnedBottomRowCount()).toBe(0);

    const amount = api.getColumn('amount')!;
    const total = () =>
      api.getCellValue({ rowNode: api.getPinnedTopRow(0)!, colKey: amount });
    expect(total()).toBe(store.grandTotal());

    // There is no Line total column any more, so this cell is the only place the
    // trip total appears in the grid — it has to follow an edit.
    const item = store.sheets()[0].items[0];
    api.getRowNode(`item:${item.id}`)!.setDataValue('amount', 1234.5);
    await settle(fixture);

    expect(total()).toBe(store.grandTotal());
  });

  /**
   * Selecting a block and copying or pasting it. AG Grid's own range selection
   * and clipboard are Enterprise, so all of this is the component's, and all of
   * it is asserted here.
   */
  describe('copy and paste', () => {
    it('marks the block a drag covers, and nothing outside it', async () => {
      const harness = await grid();
      const items = harness.store.sheets()[0].items;

      drag(harness, [`item:${items[0].id}`, 'amount'], [`item:${items[1].id}`, 'item']);
      await settle(harness.fixture);

      // Two columns by two rows, whichever way round the drag went.
      expect(selectedCells(harness.fixture).sort()).toEqual(
        [
          `item:${items[0].id}/item`,
          `item:${items[0].id}/amount`,
          `item:${items[1].id}/item`,
          `item:${items[1].id}/amount`,
        ].sort(),
      );
    });

    it('copies the block as the tab-separated text a spreadsheet reads', async () => {
      const harness = await grid();
      const [beer, pizza] = harness.store.sheets()[0].items;

      drag(harness, [`item:${beer.id}`, 'item'], [`item:${pizza.id}`, 'amount']);

      expect(copyFrom(harness.fixture)).toBe(
        `${beer.name}\t${beer.amount}\n${pizza.name}\t${pizza.amount}`,
      );
    });

    it('pastes through the same rules as typing', async () => {
      const harness = await grid();
      const [beer] = harness.store.sheets()[0].items;
      const person = harness.store.people()[0];

      drag(harness, [`item:${beer.id}`, 'item'], [`item:${beer.id}`, 'item']);
      pasteInto(harness.fixture, `Cider\t9.5\t3`);
      await settle(harness.fixture);

      const pasted = harness.store.sheets()[0].items[0];
      expect(pasted.name).toBe('Cider');
      expect(pasted.amount).toBe(9.5);
      expect(harness.store.share(pasted.id, person.id)).toEqual({ owe: 3, pay: 0 });
    });

    it('refuses a pasted share outside the workbook’s 0 – 10 validation', async () => {
      const harness = await grid();
      const [beer] = harness.store.sheets()[0].items;
      const person = harness.store.people()[0];
      const before = harness.store.share(beer.id, person.id);

      drag(harness, [`item:${beer.id}`, `person:${person.id}`], [`item:${beer.id}`, `person:${person.id}`]);
      pasteInto(harness.fixture, '11');
      await settle(harness.fixture);

      expect(harness.store.share(beer.id, person.id)).toEqual(before);
    });

    it('repeats one value across the whole selected block', async () => {
      const harness = await grid();
      const items = harness.store.sheets()[0].items;
      const person = harness.store.people()[0];

      // The reason this exists: giving several lines the same share without
      // typing it into each one.
      drag(
        harness,
        [`item:${items[0].id}`, `person:${person.id}`],
        [`item:${items[2].id}`, `person:${person.id}`],
      );
      pasteInto(harness.fixture, '2');
      await settle(harness.fixture);

      for (const item of items.slice(0, 3)) {
        expect(harness.store.share(item.id, person.id)).toEqual({ owe: 2, pay: 0 });
      }
      // The line under the block is left alone.
      expect(harness.store.share(items[3].id, person.id).owe).not.toBe(2);
    });

    it('clips a paste to the lines that exist rather than growing the sheet', async () => {
      const harness = await grid();
      const items = harness.store.sheets()[0].items;
      const before = items.length;

      drag(
        harness,
        [`item:${items.at(-1)!.id}`, 'item'],
        [`item:${items.at(-1)!.id}`, 'item'],
      );
      pasteInto(harness.fixture, 'Last line\nOne line too many');
      await settle(harness.fixture);

      expect(harness.store.sheets()[0].items.length).toBe(before);
      expect(harness.store.sheets()[0].items.at(-1)!.name).toBe('Last line');
    });

    it('leaves the pinned summary strip out of it — there is nothing to paste over', async () => {
      const harness = await grid();

      selecting(harness.fixture).onCellMouseDown(onCell(harness.api, 'balances', 'amount'));
      await settle(harness.fixture);

      expect(selectedCells(harness.fixture)).toEqual([]);
      expect(copyFrom(harness.fixture)).toBe('');
    });
  });

  it('leaves the blank row alone when nothing is typed', async () => {
    const { store, api } = await grid();

    const sheet = store.sheets()[0];
    const before = sheet.items.length;

    api.getRowNode(`add-item:${sheet.id}`)!.setDataValue('item', '   ');

    expect(store.sheets()[0].items.length).toBe(before);
  });
});
