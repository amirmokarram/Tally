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
import { LEDGER_ADD_ROW_HEIGHT, LEDGER_ROW_HEIGHT } from './grid-theme';
import { TripStore } from '../core/trip-store';
import { SESSION_STORAGE, TRIP_STORAGE } from '../core/library-storage';
import { FakeStorage } from '../core/library-storage.spec';
import { MoneyPipe } from '../core/money.pipe';

const money = new MoneyPipe();

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
  endDrag(): void;
  startFill(node: unknown, colId: string): void;
}

function selecting(fixture: ComponentFixture<SplitGrid>): Selecting {
  return fixture.componentInstance as unknown as Selecting;
}

/**
 * A real `api.setFocusedCell` — focuses a cell without editing it, the way
 * a single click does. `pressKey`, below, needs that real focus (a genuine
 * `ag-cell-focus`) to find something to dispatch a keydown at.
 */
function focusCell(api: GridApi, rowId: string, colId = 'item'): void {
  api.setFocusedCell(api.getRowNode(rowId)!.rowIndex!, colId);
}

/**
 * Tab/Enter on the add-item row are handled from the item column's own
 * `suppressKeyboardEvent`, which AG Grid calls from *inside* its own keydown
 * handling — unlike the mouse handlers above, calling that logic directly
 * would prove nothing about whether it actually pre-empts AG Grid's default
 * navigation (an earlier version of this that called it as a plain function
 * looked fine and was not: AG Grid had already run its own Tab handling by
 * the time a `(cellKeyDown)` *output* fired). A real, bubbling `keydown` is
 * what a keystroke in the editor actually produces, so it is the only way to
 * exercise the suppression itself.
 */
function pressKey(
  fixture: ComponentFixture<SplitGrid>,
  key: 'Tab' | 'Enter' | 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight',
  options?: { shiftKey?: boolean },
): void {
  const root = fixture.nativeElement as HTMLElement;
  const target =
    root.querySelector<HTMLElement>('.ag-cell-inline-editing input') ??
    root.querySelector<HTMLElement>('.ag-cell-focus')!;
  target.dispatchEvent(
    new KeyboardEvent('keydown', {
      key,
      shiftKey: options?.shiftKey ?? false,
      bubbles: true,
      cancelable: true,
    }),
  );
}

/** Stands in for the cell event AG Grid hands the two mouse handlers. */
function onCell(
  api: GridApi,
  rowId: string,
  colId: string,
  modifiers: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean } = {},
): unknown {
  return {
    node: api.getRowNode(rowId),
    column: { getColId: () => colId },
    event: new MouseEvent('mousedown', modifiers),
  };
}

/** Drags from one cell to another, the way a pointer would. */
function drag(harness: Harness, from: [string, string], to: [string, string]): void {
  const grid = selecting(harness.fixture);
  grid.onCellMouseDown(onCell(harness.api, ...from));
  grid.onCellMouseOver(onCell(harness.api, ...to));
}

/**
 * `onRowDragEnd` and `isRowValidDropPosition`, which are `protected` so the
 * template can reach them.
 */
interface RowDragHost {
  onRowDragEnd(event: unknown): void;
  isRowValidDropPosition(params: unknown): boolean;
}

function rowDragHost(fixture: ComponentFixture<SplitGrid>): RowDragHost {
  return fixture.componentInstance as unknown as RowDragHost;
}

/**
 * `rows`, `printRows`, `capturing` and `exportingPng`, which are `protected`
 * so the template can reach them.
 */
interface PrintCapture {
  rows(): { kind: string }[];
  printRows(): { kind: string }[];
  capturing: { (): boolean; set(value: boolean): void };
  exportingPng: { (): boolean; set(value: boolean): void };
}

function printCapture(fixture: ComponentFixture<SplitGrid>): PrintCapture {
  return fixture.componentInstance as unknown as PrintCapture;
}

/**
 * Stands in for the event AG Grid hands `onRowDragEnd`: real row nodes (so
 * `.data` is genuine), but `forEachNode` reports them in `orderedRowIds`
 * rather than the api's own order — standing in for what `rowDragManaged`
 * would have already done to the grid's own row model by the time this
 * fires. See {@link SplitGrid.onRowDragEnd}.
 */
function rowDragEnd(api: GridApi, draggedRowId: string, orderedRowIds: readonly string[]): unknown {
  return {
    node: api.getRowNode(draggedRowId),
    api: {
      forEachNode: (cb: (node: unknown) => void) =>
        orderedRowIds.forEach((id) => cb(api.getRowNode(id))),
    },
  };
}

/**
 * Drags the fill handle from the cell at a selection's own corner out to
 * another cell, and lets go — the handle's own hit-test is real pixel
 * geometry with nothing to unit-test, so `startFill` is called directly, the
 * cell it would have landed on standing in for the corner AG Grid would have
 * drawn the handle on.
 */
function fillDrag(harness: Harness, corner: [string, string], to: [string, string]): void {
  const grid = selecting(harness.fixture);
  const node = (onCell(harness.api, ...corner) as { node: unknown }).node;
  grid.startFill(node, corner[1]);
  grid.onCellMouseOver(onCell(harness.api, ...to));
  grid.endDrag();
}

/** Ticks the given lines, the way their check boxes would. */
function tick(harness: Harness, items: readonly { id: string }[]): void {
  harness.api.setNodesSelected({
    nodes: items.map((item) => harness.api.getRowNode(`item:${item.id}`)!),
    newValue: true,
  });
}

/** `closeShareMenu` is `protected` so the template can reach it. */
interface ShareMenuHost {
  closeShareMenu(): void;
}

function shareMenuHost(fixture: ComponentFixture<SplitGrid>): ShareMenuHost {
  return fixture.componentInstance as unknown as ShareMenuHost;
}

/** A button inside the Shares dropdown, or null while it is not open. */
function shareMenuButton(
  fixture: ComponentFixture<SplitGrid>,
  label: string,
): HTMLButtonElement | null {
  return (
    Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>(
        '.toolbar-menu button',
      ),
    ).find((button) => button.textContent!.trim().startsWith(label)) ?? null
  );
}

/** A toolbar button, found by its own `title` — same convention as {@link shareMenuButton}. */
function toolbarButton(fixture: ComponentFixture<SplitGrid>, title: string): HTMLButtonElement {
  return (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
    `.toolbar-btn[title="${title}"]`,
  )!;
}

function clipboardEvent(type: 'copy' | 'cut' | 'paste', text?: string): ClipboardEvent {
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

  it('adds a person from the button at the tail of the grid', async () => {
    const { fixture, store, api } = await grid();
    const people = store.people().length;

    // The mirror of the Sheet column's own add button: a trailing column of
    // its own, rather than the toolbar button that used to be here.
    const button = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      '.ag-header-cell[col-id="add-person"] button[aria-label="Add person"]',
    );
    expect(button).withContext('the add-person button at the tail of the grid').not.toBeNull();

    button!.click();
    await settle(fixture);

    expect(store.people().length).toBe(people + 1);
    expect(columnIds(api)).toContain(`person:${store.people().at(-1)!.id}`);
    // Stays last: a new person's column is inserted ahead of it, not after.
    expect(columnIds(api).at(-1)).toBe('add-person');
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

  /**
   * The split's own name, currency and export — moved here from the app-wide
   * header, which showed them on every tab whether or not it was this split
   * being worked on, and now sharing the totals band's own merged cell
   * rather than a masthead row of their own.
   */
  describe('the split header', () => {
    it('renames the split as the title is typed', async () => {
      const { fixture, store } = await grid();
      const input = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
        '.masthead-cell input.title-input',
      )!;

      input.value = 'Weekend in Lisbon';
      input.dispatchEvent(new Event('input'));
      await settle(fixture);

      expect(store.title()).toBe('Weekend in Lisbon');
    });

    it('changes the base currency from its own picker', async () => {
      const { store } = await grid();
      const before = store.baseCurrency();

      store.setBaseCurrency(before === 'EUR' ? 'USD' : 'EUR');

      expect(store.baseCurrency()).not.toBe(before);
    });
  });

  /**
   * Save as JSON and Save as PNG share one "Export" toolbar slot, opened as a
   * dropdown — the same pattern as the Add and Shares buttons elsewhere in
   * this toolbar. The PNG capture itself (rasterizing real DOM through
   * `html-to-image`, then either a native save picker or a download) is left
   * untested here — worth nothing beyond "does a third-party library still
   * work," and slow and flaky to boot in a headless browser.
   */
  describe('the export menu', () => {
    function exportButton(fixture: ComponentFixture<SplitGrid>): HTMLButtonElement {
      return (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
        '.toolbar-btn[title="Export this split as a JSON file or a PNG image"]',
      )!;
    }

    function menuItem(fixture: ComponentFixture<SplitGrid>, title: string): HTMLButtonElement {
      return (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
        `.toolbar-menu .btn[title="${title}"]`,
      )!;
    }

    it('opens under the Export button, with Save as JSON and Save as PNG inside', async () => {
      const { fixture } = await grid();

      expect(menuItem(fixture, 'Download this split as a JSON file')).toBeNull();

      exportButton(fixture).click();
      await settle(fixture);

      expect(menuItem(fixture, 'Download this split as a JSON file')).not.toBeNull();
      expect(menuItem(fixture, 'Save the report as a PNG image')).not.toBeNull();
    });

    it('exports the active split as a JSON download', async () => {
      const { fixture } = await grid();
      const clicked = spyOn(HTMLAnchorElement.prototype, 'click');

      exportButton(fixture).click();
      await settle(fixture);
      menuItem(fixture, 'Download this split as a JSON file').click();

      expect(clicked).toHaveBeenCalled();
    });

    it('leaves every add-item row out of the print-ready rows', async () => {
      const { fixture, store } = await grid();
      const capture = printCapture(fixture);

      expect(capture.rows().some((r) => r.kind === 'add-item')).toBe(true);
      expect(capture.printRows().some((r) => r.kind === 'add-item')).toBe(false);
      // Nothing else about the rows changes — one add-item row per sheet is
      // the only difference between the two.
      expect(capture.printRows().length).toBe(capture.rows().length - store.sheets().length);
    });

    it('disables Save as PNG for the whole export, capture and save alike', async () => {
      const { fixture } = await grid();
      const capture = printCapture(fixture);

      exportButton(fixture).click();
      await settle(fixture);
      expect(menuItem(fixture, 'Save the report as a PNG image').disabled).toBe(false);

      capture.exportingPng.set(true);
      await settle(fixture);
      expect(menuItem(fixture, 'Save the report as a PNG image').disabled).toBe(true);

      capture.exportingPng.set(false);
      await settle(fixture);
      expect(menuItem(fixture, 'Save the report as a PNG image').disabled).toBe(false);
    });

    it('reverts the flattened report before the save step, not after it', async () => {
      const { fixture } = await grid();
      const capture = printCapture(fixture);

      // `capturing` (the flattened appearance) is meant to end as soon as the
      // image is captured — well before `exportingPng` (the whole export,
      // including a possibly long-open native save dialog) does. Exercised
      // directly against the two signals rather than through a real
      // `savePng()` call, which would actually invoke `html-to-image` and a
      // real save — see this describe block's own doc comment.
      capture.exportingPng.set(true);
      capture.capturing.set(true);
      await settle(fixture);
      expect((fixture.nativeElement as HTMLElement).className).toContain('exporting-png');

      // The capture finishes; the save (e.g. a native picker) is still open —
      // `exportingPng` alone still guards re-entry and disables the button,
      // but the report itself is back to its normal, editable appearance.
      capture.capturing.set(false);
      await settle(fixture);
      expect((fixture.nativeElement as HTMLElement).className).not.toContain('exporting-png');
      expect(capture.exportingPng()).toBe(true);

      capture.exportingPng.set(false);
    });
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
    // figure the settle-up view reads changes.
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

  it('reads a typed owe|pay pair the same as the packed decimal it replaced', async () => {
    const { store, api } = await grid();

    const person = store.people()[0];
    const item = store.sheets()[0].items[0];

    api.getRowNode(`item:${item.id}`)!.setDataValue(`person:${person.id}`, '2|1');

    expect(store.share(item.id, person.id)).toEqual({ owe: 2, pay: 1 });
  });

  it('still accepts the old owe.pay decimal, for muscle memory from the spreadsheet', async () => {
    const { store, api } = await grid();

    const person = store.people()[0];
    const item = store.sheets()[0].items[0];

    api.getRowNode(`item:${item.id}`)!.setDataValue(`person:${person.id}`, '2.1');

    expect(store.share(item.id, person.id)).toEqual({ owe: 2, pay: 1 });
  });

  it('refuses a pay digit outside 0 – 9 in the owe|pay form', async () => {
    const { store, api } = await grid();

    const person = store.people()[0];
    const item = store.sheets()[0].items[0];
    const before = store.share(item.id, person.id);

    api.getRowNode(`item:${item.id}`)!.setDataValue(`person:${person.id}`, '1|10');

    expect(store.share(item.id, person.id)).toEqual(before);
  });

  /**
   * Ticking lines and acting on all of them at once — what replaced the three
   * buttons that used to sit on every row in a column of their own.
   */
  describe('the ticked lines', () => {
    it('deletes every ticked line from its own toolbar button, and takes its shares with it', async () => {
      const harness = await grid();
      const items = harness.store.sheets()[0].items;
      const person = harness.store.people()[0];
      const doomed = [items[1], items[2]];
      const before = harness.store.balances().find((b) => b.personId === person.id)!.balance;

      tick(harness, doomed);
      await settle(harness.fixture);

      toolbarButton(harness.fixture, 'Delete ticked lines').click();
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

    it('disables Delete and Shares until a line is ticked', async () => {
      const harness = await grid();
      const item = harness.store.sheets()[0].items[0];

      expect(toolbarButton(harness.fixture, 'Delete ticked lines').disabled).toBe(true);
      expect(toolbarButton(harness.fixture, 'Set shares for ticked lines').disabled).toBe(true);

      tick(harness, [item]);
      await settle(harness.fixture);

      expect(toolbarButton(harness.fixture, 'Delete ticked lines').disabled).toBe(false);
      expect(toolbarButton(harness.fixture, 'Set shares for ticked lines').disabled).toBe(false);
    });

    it('gives everyone a share of the ticked lines from the Shares dropdown, and clears them again', async () => {
      const harness = await grid();
      const items = harness.store.sheets()[0].items;
      const people = harness.store.people();

      tick(harness, [items[0]]);
      await settle(harness.fixture);
      toolbarButton(harness.fixture, 'Set shares for ticked lines').click();
      await settle(harness.fixture);
      shareMenuButton(harness.fixture, 'Everyone')!.click();
      await settle(harness.fixture);

      for (const person of people) {
        expect(harness.store.share(items[0].id, person.id).owe).toBe(1);
      }

      toolbarButton(harness.fixture, 'Set shares for ticked lines').click();
      await settle(harness.fixture);
      shareMenuButton(harness.fixture, 'Clear shares')!.click();
      await settle(harness.fixture);

      for (const person of people) {
        expect(harness.store.share(items[0].id, person.id)).toEqual({ owe: 0, pay: 0 });
      }
    });

    it('shows no Shares dropdown until its toolbar button is clicked', async () => {
      const harness = await grid();
      const item = harness.store.sheets()[0].items[0];

      tick(harness, [item]);
      await settle(harness.fixture);
      expect(shareMenuButton(harness.fixture, 'Everyone')).toBeNull();

      toolbarButton(harness.fixture, 'Set shares for ticked lines').click();
      await settle(harness.fixture);
      expect(shareMenuButton(harness.fixture, 'Everyone')).not.toBeNull();

      shareMenuHost(harness.fixture).closeShareMenu();
      await settle(harness.fixture);
      expect(shareMenuButton(harness.fixture, 'Everyone')).toBeNull();
    });

    it('clicking the Shares button again closes its own dropdown', async () => {
      const harness = await grid();
      const item = harness.store.sheets()[0].items[0];

      tick(harness, [item]);
      await settle(harness.fixture);

      const button = toolbarButton(harness.fixture, 'Set shares for ticked lines');
      button.click();
      await settle(harness.fixture);
      expect(shareMenuButton(harness.fixture, 'Everyone')).not.toBeNull();

      button.click();
      await settle(harness.fixture);
      expect(shareMenuButton(harness.fixture, 'Everyone')).toBeNull();
    });

    it('right-clicking a ticked line’s own number does not untick it first', async () => {
      const harness = await grid();
      const items = harness.store.sheets()[0].items;
      const sel = selecting(harness.fixture);

      tick(harness, [items[0]]);
      await settle(harness.fixture);

      // A browser fires `mousedown` for every button, not just the left one —
      // this is the right button's, the one a real right-click sends before
      // its own native context menu.
      sel.onCellMouseDown({
        node: harness.api.getRowNode(`item:${items[0].id}`),
        column: { getColId: () => 'index' },
        event: new MouseEvent('mousedown', { button: 2 }),
      });
      await settle(harness.fixture);

      expect(harness.api.getSelectedNodes().length).toBe(1);
    });

    it('will not tick the blank row that ends a block', async () => {
      const { fixture, api, store } = await grid();
      const sheet = store.sheets()[0];

      expect(api.getRowNode(`add-item:${sheet.id}`)!.selectable).toBe(false);
      expect(api.getRowNode(`item:${sheet.items[0].id}`)!.selectable).toBe(true);

      // A click on the line number only ticks a real line — the blank row
      // that ends a block is not one yet, and a click on its own line number
      // cell does nothing.
      const sel = selecting(fixture);
      sel.onCellMouseDown(onCell(api, `add-item:${sheet.id}`, 'index'));
      await settle(fixture);

      expect(api.getSelectedNodes().length).toBe(0);
    });

    /** Row ids as `getSelectedNodes` would return them, in no particular order. */
    function selectedIds(api: GridApi): string[] {
      return api.getSelectedNodes().map((n) => n.id!).sort();
    }

    it('ticks a line from its own line number, replacing whatever was ticked before', async () => {
      const { fixture, api, store } = await grid();
      const items = store.sheets()[0].items;
      const sel = selecting(fixture);

      sel.onCellMouseDown(onCell(api, `item:${items[0].id}`, 'index'));
      await settle(fixture);
      expect(api.getSelectedNodes().map((n) => n.data)).toEqual([
        jasmine.objectContaining({ kind: 'item' }),
      ]);

      // A plain click on a different line's number moves the tick there
      // instead of adding to it — the usual row-picker convention, not the
      // checkbox-column toggle it replaced.
      sel.onCellMouseDown(onCell(api, `item:${items[1].id}`, 'index'));
      await settle(fixture);
      expect(selectedIds(api)).toEqual([`item:${items[1].id}`]);

      // Clicking the same line's number again is still a plain click: it
      // stays ticked rather than toggling off.
      sel.onCellMouseDown(onCell(api, `item:${items[1].id}`, 'index'));
      await settle(fixture);
      expect(selectedIds(api)).toEqual([`item:${items[1].id}`]);
    });

    it('adds or drops a single line with Ctrl/Cmd+click, leaving the rest of the tick alone', async () => {
      const { fixture, api, store } = await grid();
      const items = store.sheets()[0].items;
      const sel = selecting(fixture);

      sel.onCellMouseDown(onCell(api, `item:${items[0].id}`, 'index'));
      await settle(fixture);

      sel.onCellMouseDown(onCell(api, `item:${items[2].id}`, 'index', { ctrlKey: true }));
      await settle(fixture);
      expect(selectedIds(api)).toEqual([`item:${items[0].id}`, `item:${items[2].id}`].sort());

      // Ctrl/Cmd+click on an already-ticked line drops just that one.
      sel.onCellMouseDown(onCell(api, `item:${items[0].id}`, 'index', { metaKey: true }));
      await settle(fixture);
      expect(selectedIds(api)).toEqual([`item:${items[2].id}`]);
    });

    it('ticks every line between two line numbers with Shift+click', async () => {
      const { fixture, api, store } = await grid();
      const items = store.sheets()[0].items;
      const sel = selecting(fixture);

      // The anchor a Shift+click extends from is the last plain (or
      // Ctrl/Cmd) click — not touched by the Shift+click itself.
      sel.onCellMouseDown(onCell(api, `item:${items[0].id}`, 'index'));
      await settle(fixture);

      sel.onCellMouseDown(onCell(api, `item:${items[3].id}`, 'index', { shiftKey: true }));
      await settle(fixture);
      expect(selectedIds(api)).toEqual(
        [0, 1, 2, 3].map((i) => `item:${items[i].id}`).sort(),
      );

      // A second Shift+click from the same anchor can shrink the range
      // instead of re-anchoring to where the first one landed.
      sel.onCellMouseDown(onCell(api, `item:${items[1].id}`, 'index', { shiftKey: true }));
      await settle(fixture);
      expect(selectedIds(api)).toEqual([0, 1].map((i) => `item:${items[i].id}`).sort());
    });

    it('ticks every line from the line number header, and drops them all the same way', async () => {
      const { fixture, api, store } = await grid();
      const host = fixture.nativeElement as HTMLElement;
      const header = () =>
        host.querySelector<HTMLButtonElement>('.ag-header-cell[col-id="index"] button')!;

      header().click();
      await settle(fixture);

      expect(api.getSelectedNodes().length).toBe(store.sheets()[0].items.length);
      expect(header().getAttribute('aria-label')).toBe('Untick every line');

      header().click();
      await settle(fixture);

      expect(api.getSelectedNodes().length).toBe(0);
      expect(header().getAttribute('aria-label')).toBe('Tick every line');
    });
  });

  describe('reordering lines', () => {
    it('moves a dragged line to wherever it was dropped within its own sheet', async () => {
      const { fixture, api, store } = await grid();
      const ids = store.sheets()[0].items.map((item) => item.id);
      // Beer, Pizza, Burger, Steak, Coke — drag Steak to the front.
      const dropped = [ids[3], ids[0], ids[1], ids[2], ids[4]];

      rowDragHost(fixture).onRowDragEnd(
        rowDragEnd(
          api,
          `item:${ids[3]}`,
          dropped.map((id) => `item:${id}`),
        ),
      );
      await settle(fixture);

      expect(store.sheets()[0].items.map((item) => item.id)).toEqual(dropped);
    });

    it('leaves no undo step when a line is dropped back where it started', async () => {
      const { fixture, api, store } = await grid();
      const ids = store.sheets()[0].items.map((item) => item.id);

      rowDragHost(fixture).onRowDragEnd(
        rowDragEnd(
          api,
          `item:${ids[0]}`,
          ids.map((id) => `item:${id}`),
        ),
      );
      await settle(fixture);

      expect(store.sheets()[0].items.map((item) => item.id)).toEqual(ids);
      const undoBtn = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
        '.toolbar-btn[title="Undo (Ctrl+Z)"]',
      )!;
      expect(undoBtn.disabled).toBe(true);
    });

    it('only allows a drop onto another line in the same sheet', async () => {
      const { fixture, api, store } = await grid();
      const firstSheet = store.sheets()[0];
      const secondSheet = store.addSheet('Taxi');
      store.addItem(secondSheet.id, 'Ride', 20);
      await settle(fixture);

      const host = rowDragHost(fixture);
      const source = api.getRowNode(`item:${firstSheet.items[0].id}`);
      const valid = (overNode: unknown) => host.isRowValidDropPosition({ source, overNode });

      expect(valid(api.getRowNode(`item:${firstSheet.items[1].id}`))).toBe(true);
      expect(valid(api.getRowNode(`item:${store.sheets()[1].items[0].id}`))).toBe(false);
      expect(valid(api.getRowNode(`add-item:${firstSheet.id}`))).toBe(false);
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

    /** The totals band above the grid — see `split-grid.html`. */
    function totalsCell(fixture: ComponentFixture<SplitGrid>, selector: string): string {
      return (fixture.nativeElement as HTMLElement)
        .querySelector(`.totals-band ${selector}`)!
        .textContent!.trim();
    }

    it('shows a person’s balance the way it shows the trip total', async () => {
      const { fixture, store } = await grid();
      const person = store.people()[0];

      // Both carry the symbol; both put a credit in parentheses rather than
      // behind a minus sign, the way the workbook showed someone who is owed.
      expect(totalsCell(fixture, '.grand-amount')).toMatch(/^\$[\d,]+\.\d\d$/);
      expect(totalsCell(fixture, `[data-person-id="${person.id}"]`)).toMatch(
        /^\(?\$[\d,]+\.\d\d\)?$/,
      );
    });

    it('shows an owe-only share bare, not with a trailing |0', async () => {
      const { fixture, store } = await grid();
      const item = store.sheets()[0].items[0];
      const person = store.people()[0];

      expect(text(fixture, `item:${item.id}`, `person:${person.id}`)).toBe('1');
    });

    it('shows owe|pay, not the packed decimal underneath, once both sides are set', async () => {
      const { fixture, store, api } = await grid();
      const item = store.sheets()[0].items[0];
      const person = store.people()[0];

      api.getRowNode(`item:${item.id}`)!.setDataValue(`person:${person.id}`, '2|1');
      await settle(fixture);

      expect(text(fixture, `item:${item.id}`, `person:${person.id}`)).toBe('2|1');
    });

    it('shows a pay-only share as |pay, not with a leading 0', async () => {
      const { fixture, store, api } = await grid();
      const item = store.sheets()[0].items[0];
      const person = store.people()[0];

      api.getRowNode(`item:${item.id}`)!.setDataValue(`person:${person.id}`, '0|1');
      await settle(fixture);

      expect(text(fixture, `item:${item.id}`, `person:${person.id}`)).toBe('|1');
    });

    /** The share editor's own `<input>` — a live mask, not the grid's plain text one. */
    function shareEditor(fixture: ComponentFixture<SplitGrid>): HTMLInputElement {
      return (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
        '.ledger-share.ag-cell-inline-editing input',
      )!;
    }

    /** A single keystroke into whichever input the mask currently owns. */
    async function press(fixture: ComponentFixture<SplitGrid>, key: string): Promise<void> {
      shareEditor(fixture).dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
      );
      await settle(fixture);
    }

    it('masks an empty share cell with the shape it is typed in, _|_', async () => {
      const { fixture, store, api } = await grid();
      const item = store.sheets()[0].items[0];
      const person = store.people()[0];

      store.clearItemShares(item.id);
      await settle(fixture);

      api.startEditingCell({ rowIndex: 0, colKey: `person:${person.id}` });
      await settle(fixture);

      expect(shareEditor(fixture).value).toBe('_|_');
    });

    it('seeds the editor with the digit that started the edit, not the value it replaces', async () => {
      const { fixture, store, api } = await grid();
      const item = store.sheets()[0].items[0];
      const person = store.people()[0];

      api.startEditingCell({ rowIndex: 0, colKey: `person:${person.id}`, key: '2' });
      await settle(fixture);

      expect(shareEditor(fixture).value).toBe('2|_');
    });

    it('seeds the editor with what the cell shows, not the packed decimal, on an ordinary edit', async () => {
      const { fixture, store, api } = await grid();
      const item = store.sheets()[0].items[0];
      const person = store.people()[0];

      api.getRowNode(`item:${item.id}`)!.setDataValue(`person:${person.id}`, '2|1');
      await settle(fixture);

      api.startEditingCell({ rowIndex: 0, colKey: `person:${person.id}` });
      await settle(fixture);

      expect(shareEditor(fixture).value).toBe('2|1');
    });

    it('advances past the pipe on its own once one owe digit is typed', async () => {
      const { fixture, store, api } = await grid();
      const item = store.sheets()[0].items[0];
      const person = store.people()[0];

      store.clearItemShares(item.id);
      await settle(fixture);
      api.startEditingCell({ rowIndex: 0, colKey: `person:${person.id}` });
      await settle(fixture);

      await press(fixture, '2');
      expect(shareEditor(fixture).value).toBe('2|_');

      await press(fixture, '1');
      expect(shareEditor(fixture).value).toBe('2|1');

      await press(fixture, 'Enter');
      expect(store.share(item.id, person.id)).toEqual({ owe: 2, pay: 1 });
    });

    it('reaches a share of 10 by backing into the owe slot instead of erasing it', async () => {
      const { fixture, store, api } = await grid();
      const item = store.sheets()[0].items[0];
      const person = store.people()[0];

      store.clearItemShares(item.id);
      await settle(fixture);
      api.startEditingCell({ rowIndex: 0, colKey: `person:${person.id}` });
      await settle(fixture);

      await press(fixture, '1');
      expect(shareEditor(fixture).value).toBe('1|_');

      // Backspace on the empty pay slot steps back into owe without erasing it.
      await press(fixture, 'Backspace');
      expect(shareEditor(fixture).value).toBe('1|_');

      await press(fixture, '0');
      expect(shareEditor(fixture).value).toBe('10|_');

      await press(fixture, 'Enter');
      expect(store.share(item.id, person.id)).toEqual({ owe: 10, pay: 0 });
    });

    it('replaces a pre-filled slot on the first digit instead of appending to it', async () => {
      const { fixture, store, api } = await grid();
      const item = store.sheets()[0].items[0];
      const person = store.people()[0];

      api.getRowNode(`item:${item.id}`)!.setDataValue(`person:${person.id}`, '2|1');
      await settle(fixture);
      api.startEditingCell({ rowIndex: 0, colKey: `person:${person.id}` });
      await settle(fixture);

      // Replacing owe leaves the pre-filled pay digit alone rather than
      // clearing the whole cell — only the slot actually typed into changes.
      await press(fixture, '3');
      expect(shareEditor(fixture).value).toBe('3|1');

      await press(fixture, '9');
      expect(shareEditor(fixture).value).toBe('3|9');

      await press(fixture, 'Enter');
      expect(store.share(item.id, person.id)).toEqual({ owe: 3, pay: 9 });
    });

    it('blocks anything but a digit from reaching the mask', async () => {
      const { fixture, store, api } = await grid();
      const item = store.sheets()[0].items[0];
      const person = store.people()[0];

      store.clearItemShares(item.id);
      await settle(fixture);
      api.startEditingCell({ rowIndex: 0, colKey: `person:${person.id}` });
      await settle(fixture);

      await press(fixture, 'a');
      await press(fixture, '|');
      await press(fixture, '.');
      await press(fixture, ' ');
      expect(shareEditor(fixture).value).toBe('_|_');

      // A digit still gets through around them.
      await press(fixture, '2');
      expect(shareEditor(fixture).value).toBe('2|_');
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
      expect(totalsCell(fixture, '.grand-amount').startsWith('$')).toBe(true);
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
   * Rendering is normally AG Grid's own problem (see the top of this file) —
   * but a selected cell's own ring (`.ledger-selected`), the fill handle's
   * own corner square, and AG Grid's native editing chrome (on both the cell
   * *and*, independently, the input inside it) have all in turn stacked into
   * a doubled or rounded border the moment a selected line is double-clicked
   * into its editor. Real assertions on real computed styles, in a real
   * browser (Karma's Chrome launcher, not jsdom) — the only way anything
   * here actually proves what is drawn rather than what the DOM merely says.
   */
  describe('editing a selected cell', () => {
    function editingCell(fixture: ComponentFixture<SplitGrid>): HTMLElement {
      return (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
        '.ag-cell-inline-editing',
      )!;
    }

    /** Selects, then edits, the way a real double-click does both at once. */
    async function selectAndEdit(harness: Harness, rowId: string, colId: string): Promise<void> {
      drag(harness, [rowId, colId], [rowId, colId]);
      await settle(harness.fixture);
      harness.api.startEditingCell({
        rowIndex: harness.api.getRowNode(rowId)!.rowIndex!,
        colKey: colId,
      });
      await settle(harness.fixture);
    }

    for (const [colId, label] of [
      ['item', 'Item'],
      ['amount', 'Amount'],
    ] as const) {
      it(`draws a single flat, square border around a selected, editing ${label} cell`, async () => {
        const harness = await grid();
        const rowId = `item:${harness.store.sheets()[0].items[0].id}`;

        await selectAndEdit(harness, rowId, colId);

        const cell = editingCell(harness.fixture);
        const cellStyle = getComputedStyle(cell);
        // The cell's own edit border is the one ring this should draw —
        // square, flat, and not doubled by the selection ring underneath it.
        expect(cellStyle.borderRadius).toBe('0px');
        expect(cellStyle.boxShadow).toBe('none');

        const input = cell.querySelector('input')!;
        const inputStyle = getComputedStyle(input);
        // AG Grid gives the input this same rounded, glowing chrome a second
        // time, independently of the cell's own — left alone, flattening
        // only the cell leaves a rounded input floating inside a square one.
        expect(inputStyle.border).toBe('0px none rgb(22, 35, 58)');
        expect(inputStyle.borderRadius).toBe('0px');
        expect(inputStyle.boxShadow).toBe('none');
      });
    }

    it('draws no fill-handle square on a cell that is being edited', async () => {
      const harness = await grid();
      const rowId = `item:${harness.store.sheets()[0].items[0].id}`;

      await selectAndEdit(harness, rowId, 'item');

      const cell = editingCell(harness.fixture);
      expect(cell.classList.contains('ledger-fill-handle')).toBe(true);
      expect(getComputedStyle(cell, '::after').content).toBe('none');
    });

    it('still draws the selection ring and fill-handle square once editing ends', async () => {
      const harness = await grid();
      const rowId = `item:${harness.store.sheets()[0].items[0].id}`;

      await selectAndEdit(harness, rowId, 'item');
      harness.api.stopEditing();
      await settle(harness.fixture);

      const cell = (harness.fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
        '.ledger-item.ledger-selected',
      )!;
      expect(getComputedStyle(cell).boxShadow).toContain('inset');
      expect(getComputedStyle(cell, '::after').content).not.toBe('none');
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

    // Five items and the "add" line under them — collapsed, since nothing
    // has focused it here.
    expect(merged().style.height).toBe(`${5 * LEDGER_ROW_HEIGHT + LEDGER_ADD_ROW_HEIGHT - 1}px`);

    api.getRowNode(`add-item:${sheet.id}`)!.setDataValue('item', 'Digestif');
    await settle(fixture);

    expect(merged().style.height).toBe(`${6 * LEDGER_ROW_HEIGHT + LEDGER_ADD_ROW_HEIGHT - 1}px`);
  });

  /**
   * Short until it's actually the one being typed on — see the plan behind
   * this: a blank row that looked and behaved like every other one made it
   * easy to lose track of, entering data by keyboard across several sheets.
   * Item and Amount are both live, separate fields — a new item can start
   * from either one — while index, person, and add-person stay hatched,
   * unfocusable blocks since there is no line yet to number or split.
   */
  describe('the add-item row', () => {
    function row(fixture: ComponentFixture<SplitGrid>, rowId: string): HTMLElement {
      return (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
        `.ag-row[row-id="${rowId}"]`,
      )!;
    }

    function cellIds(fixture: ComponentFixture<SplitGrid>, rowId: string): (string | null)[] {
      return Array.from(row(fixture, rowId).querySelectorAll('[col-id]')).map((cell) =>
        cell.getAttribute('col-id'),
      );
    }

    /** Starts real editing on the add-item row's Item cell, the way a double-click would. */
    function startEditingAddRow(api: GridApi, rowId: string): void {
      api.startEditingCell({ rowIndex: api.getRowNode(rowId)!.rowIndex!, colKey: 'item' });
    }

    it('is short by default, with Item and Amount both live', async () => {
      const { fixture, store } = await grid();
      const rowId = `add-item:${store.sheets()[0].id}`;

      expect(row(fixture, rowId).style.height).toBe(`${LEDGER_ADD_ROW_HEIGHT}px`);
      // Item and Amount are both real, separate cells — a new item can start
      // from either one.
      expect(cellIds(fixture, rowId)).toEqual([
        'index',
        'item',
        'amount',
        'person:p1',
        'add-person',
      ]);
    });

    it('stays short even once it is only focused, not edited', async () => {
      const { fixture, store, api } = await grid();
      const rowId = `add-item:${store.sheets()[0].id}`;

      // A plain click selects one of the row's fields; it is not yet a
      // request to type, so nothing about the row should react to it.
      focusCell(api, rowId);
      await settle(fixture);

      expect(row(fixture, rowId).style.height).toBe(`${LEDGER_ADD_ROW_HEIGHT}px`);
    });

    it('grows to full height once it is actually being edited', async () => {
      const { fixture, store, api } = await grid();
      const rowId = `add-item:${store.sheets()[0].id}`;

      startEditingAddRow(api, rowId);
      await settle(fixture);

      expect(row(fixture, rowId).style.height).toBe(`${LEDGER_ROW_HEIGHT}px`);
    });

    it('collapses again once editing ends without a name being entered', async () => {
      const { fixture, store, api } = await grid();
      const rowId = `add-item:${store.sheets()[0].id}`;

      startEditingAddRow(api, rowId);
      await settle(fixture);
      api.stopEditing(true);
      await settle(fixture);

      expect(row(fixture, rowId).style.height).toBe(`${LEDGER_ADD_ROW_HEIGHT}px`);
    });

    it('creates the item and moves focus to Amount when Tab is pressed after typing a name', async () => {
      const { fixture, store, api } = await grid();
      const sheet = store.sheets()[0];
      const addRowId = `add-item:${sheet.id}`;
      const before = sheet.items.length;

      startEditingAddRow(api, addRowId);
      await settle(fixture);
      const editor = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
        '.ag-cell-inline-editing input',
      )!;
      editor.value = 'Digestif';
      editor.dispatchEvent(new Event('input'));

      pressKey(fixture, 'Tab');
      await settle(fixture);

      const items = store.sheets()[0].items;
      expect(items.length).toBe(before + 1);
      expect(items.at(-1)!.name).toBe('Digestif');

      // A real item row now, so Amount reads its usual way — not the
      // add-item row's own suppressed keyboard handling.
      const focused = api.getFocusedCell();
      expect(focused?.column.getColId()).toBe('amount');
      expect(api.getDisplayedRowAtIndex(focused!.rowIndex)?.data).toEqual(
        jasmine.objectContaining({ kind: 'item' }),
      );
    });

    it('creates the item and focuses the next blank row, ready to type, when Enter is pressed', async () => {
      const { fixture, store, api } = await grid();
      const sheet = store.sheets()[0];
      const addRowId = `add-item:${sheet.id}`;
      const before = sheet.items.length;

      startEditingAddRow(api, addRowId);
      await settle(fixture);
      const editor = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
        '.ag-cell-inline-editing input',
      )!;
      editor.value = 'Nightcap';
      editor.dispatchEvent(new Event('input'));

      pressKey(fixture, 'Enter');
      await settle(fixture);

      expect(store.sheets()[0].items.length).toBe(before + 1);

      // Same row id — the sheet's add-item row is stable — but it's a fresh
      // blank line now, focused and ready to type the next one.
      const focused = api.getFocusedCell();
      expect(focused?.column.getColId()).toBe('item');
      expect(api.getDisplayedRowAtIndex(focused!.rowIndex)?.id).toBe(addRowId);
      expect(api.getEditingCells().length).toBe(1);
    });

    it('does nothing special on Tab or Enter when nothing was typed', async () => {
      const { fixture, store, api } = await grid();
      const sheet = store.sheets()[0];
      const addRowId = `add-item:${sheet.id}`;
      const before = sheet.items.length;

      focusCell(api, addRowId);
      await settle(fixture);

      pressKey(fixture, 'Tab');
      await settle(fixture);

      // Nothing typed, so nothing created — focus has nowhere new to move.
      expect(store.sheets()[0].items.length).toBe(before);
      const focused = api.getFocusedCell();
      expect(focused?.column.getColId()).toBe('item');
      expect(focused && api.getDisplayedRowAtIndex(focused.rowIndex)?.id).toBe(addRowId);
    });
  });

  it('carries the trip total on the totals band, above the grid', async () => {
    const { fixture, store, api } = await grid();

    const total = () =>
      (fixture.nativeElement as HTMLElement)
        .querySelector('.totals-band .grand-amount')!
        .textContent!.trim();
    expect(total()).toBe(money.transform(store.grandTotal(), '$'));

    // There is no Line total column any more, so this cell is the only place
    // the trip total appears above the grid — it has to follow an edit.
    const item = store.sheets()[0].items[0];
    api.getRowNode(`item:${item.id}`)!.setDataValue('amount', 1234.5);
    await settle(fixture);

    expect(total()).toBe(money.transform(store.grandTotal(), '$'));
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
  });

  /**
   * Whole-line Copy/Cut/Paste, off the same tick used for the toolbar's
   * Delete / Everyone / Clear shares — a different thing from the cell-block
   * copy/paste above, which only ever carries values, never a whole line.
   */
  describe('row copy, cut and paste', () => {
    const COPY_TITLE = 'Copy ticked lines (Ctrl+C)';
    const CUT_TITLE = 'Cut ticked lines — dimmed until pasted elsewhere, or Esc to cancel (Ctrl+X)';
    const PASTE_TITLE = 'Paste lines after the selection (Ctrl+V when lines are ticked)';

    it('disables Copy, Cut and Paste until there is something to act on', async () => {
      const harness = await grid();
      const item = harness.store.sheets()[0].items[0];

      expect(toolbarButton(harness.fixture, COPY_TITLE).disabled).toBe(true);
      expect(toolbarButton(harness.fixture, CUT_TITLE).disabled).toBe(true);
      expect(toolbarButton(harness.fixture, PASTE_TITLE).disabled).toBe(true);

      tick(harness, [item]);
      await settle(harness.fixture);

      expect(toolbarButton(harness.fixture, COPY_TITLE).disabled).toBe(false);
      expect(toolbarButton(harness.fixture, CUT_TITLE).disabled).toBe(false);
      // Still nothing copied yet.
      expect(toolbarButton(harness.fixture, PASTE_TITLE).disabled).toBe(true);
    });

    it('copies ticked lines and pastes a full copy — name, amount and every share — after the last one ticked, as many times as asked', async () => {
      const harness = await grid();
      const items = harness.store.sheets()[0].items;
      const person = harness.store.people()[0];
      const [beer, pizza] = items;

      tick(harness, [beer, pizza]);
      await settle(harness.fixture);
      toolbarButton(harness.fixture, COPY_TITLE).click();
      await settle(harness.fixture);

      // Copy un-ticks the same way Cut does, so Paste has to fall back to a
      // plain cell selection for a target.
      drag(harness, [`item:${pizza.id}`, 'item'], [`item:${pizza.id}`, 'item']);
      await settle(harness.fixture);
      toolbarButton(harness.fixture, PASTE_TITLE).click();
      await settle(harness.fixture);

      const after = harness.store.sheets()[0].items;
      expect(after.length).toBe(items.length + 2);
      // Landed right after Pizza — the last of the two lines ticked — not at
      // the sheet's end.
      expect(after[2].name).toBe(beer.name);
      expect(after[2].amount).toBe(beer.amount);
      expect(after[3].name).toBe(pizza.name);
      // The originals are untouched — this was a copy, not a cut.
      expect(harness.store.share(beer.id, person.id)).toEqual({ owe: 1, pay: 0 });
      expect(harness.store.share(after[2].id, person.id)).toEqual({ owe: 1, pay: 0 });

      // A copy is repeatable — pasting again does not clear the clipboard.
      expect(toolbarButton(harness.fixture, PASTE_TITLE).disabled).toBe(false);
      toolbarButton(harness.fixture, PASTE_TITLE).click();
      await settle(harness.fixture);
      expect(harness.store.sheets()[0].items.length).toBe(items.length + 4);
    });

    /**
     * A Copy un-ticks its source the same way a Cut does, but marks it with
     * a dashed outline — Excel's own marching ants — rather than the Cut's
     * dimming, since nothing here is about to be removed.
     */
    describe('copying', () => {
      function isMarked(fixture: ComponentFixture<SplitGrid>, itemId: string): boolean {
        return !!(fixture.nativeElement as HTMLElement)
          .querySelector(`.ag-row[row-id="item:${itemId}"] [col-id="index"]`)
          ?.classList.contains('ledger-copied');
      }

      it('marks the ticked lines with a dashed outline instead of dimming them, and un-ticks them', async () => {
        const harness = await grid();
        const beer = harness.store.sheets()[0].items[0];

        tick(harness, [beer]);
        await settle(harness.fixture);
        toolbarButton(harness.fixture, COPY_TITLE).click();
        await settle(harness.fixture);

        expect(isMarked(harness.fixture, beer.id)).toBe(true);
        expect(harness.api.getSelectedNodes().length).toBe(0);
      });

      it('leaves the mark in place after a Paste — a Copy is repeatable — but a fresh Copy or Cut replaces it', async () => {
        const harness = await grid();
        const [beer, pizza] = harness.store.sheets()[0].items;

        tick(harness, [beer]);
        await settle(harness.fixture);
        toolbarButton(harness.fixture, COPY_TITLE).click();
        await settle(harness.fixture);

        drag(harness, [`item:${beer.id}`, 'item'], [`item:${beer.id}`, 'item']);
        await settle(harness.fixture);
        toolbarButton(harness.fixture, PASTE_TITLE).click();
        await settle(harness.fixture);

        expect(isMarked(harness.fixture, beer.id)).toBe(true);

        // A fresh Copy elsewhere clears the old mark.
        tick(harness, [pizza]);
        await settle(harness.fixture);
        toolbarButton(harness.fixture, COPY_TITLE).click();
        await settle(harness.fixture);

        expect(isMarked(harness.fixture, beer.id)).toBe(false);
        expect(isMarked(harness.fixture, pizza.id)).toBe(true);
      });

      it('Esc cancels the copy entirely — mark and clipboard both — the same full cancel a pending Cut gets', async () => {
        const harness = await grid();
        const beer = harness.store.sheets()[0].items[0];

        tick(harness, [beer]);
        await settle(harness.fixture);
        toolbarButton(harness.fixture, COPY_TITLE).click();
        await settle(harness.fixture);

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await settle(harness.fixture);
        expect(isMarked(harness.fixture, beer.id)).toBe(false);

        // Nothing left to paste — a stale, "cancelled" copy must not survive
        // to land on some later, unrelated selection.
        drag(harness, [`item:${beer.id}`, 'item'], [`item:${beer.id}`, 'item']);
        await settle(harness.fixture);
        expect(toolbarButton(harness.fixture, PASTE_TITLE).disabled).toBe(true);
      });
    });

    /**
     * Cut does not delete on the spot — Explorer's own convention, not a
     * spreadsheet's: the line dims and stays exactly where it is until a
     * Paste actually moves it, or Escape calls the whole thing off.
     */
    describe('cutting', () => {
      function isDimmed(fixture: ComponentFixture<SplitGrid>, itemId: string): boolean {
        return !!(fixture.nativeElement as HTMLElement)
          .querySelector(`.ag-row[row-id="item:${itemId}"] [col-id="index"]`)
          ?.classList.contains('ledger-cut-pending');
      }

      it('dims the ticked lines instead of removing them, and un-ticks them', async () => {
        const harness = await grid();
        const doomed = harness.store.sheets()[0].items[0];
        const before = harness.store.sheets()[0].items.length;

        tick(harness, [doomed]);
        await settle(harness.fixture);
        toolbarButton(harness.fixture, CUT_TITLE).click();
        await settle(harness.fixture);

        expect(harness.store.sheets()[0].items.length).toBe(before);
        expect(harness.store.sheets()[0].items.map((i) => i.id)).toContain(doomed.id);
        expect(isDimmed(harness.fixture, doomed.id)).toBe(true);
        expect(harness.api.getSelectedNodes().length).toBe(0);
      });

      it('removes the dimmed line only once Paste actually moves it — even into a different sheet — and only once', async () => {
        const harness = await grid();
        const person = harness.store.people()[0];
        const doomed = harness.store.sheets()[0].items[0];
        const doomedShare = harness.store.share(doomed.id, person.id);

        const drinks = harness.store.addSheet('Drinks');
        const target = harness.store.addItem(drinks.id, 'Water', 2);
        await settle(harness.fixture);

        tick(harness, [doomed]);
        await settle(harness.fixture);
        toolbarButton(harness.fixture, CUT_TITLE).click();
        await settle(harness.fixture);

        // Nothing ticked any more — Paste has to fall back to the cell
        // selected on the *other* sheet.
        drag(harness, [`item:${target.id}`, 'item'], [`item:${target.id}`, 'item']);
        await settle(harness.fixture);
        expect(toolbarButton(harness.fixture, PASTE_TITLE).disabled).toBe(false);
        toolbarButton(harness.fixture, PASTE_TITLE).click();
        await settle(harness.fixture);

        expect(harness.store.sheets()[0].items.map((i) => i.id)).not.toContain(doomed.id);
        const drinksItems = harness.store.sheets().find((s) => s.id === drinks.id)!.items;
        expect(drinksItems[0].id).toBe(target.id);
        expect(drinksItems[1].name).toBe(doomed.name);
        expect(drinksItems[1].amount).toBe(doomed.amount);
        // The share carried over to the new sheet — shares live at trip level.
        expect(harness.store.share(drinksItems[1].id, person.id)).toEqual(doomedShare);

        // A cut only ever lands once — the source is gone, so there is
        // nothing left for a second Paste to place.
        expect(toolbarButton(harness.fixture, PASTE_TITLE).disabled).toBe(true);
        const countBeforeSecondPaste = harness.store.sheets().reduce((n, s) => n + s.items.length, 0);
        toolbarButton(harness.fixture, PASTE_TITLE).click();
        await settle(harness.fixture);
        expect(
          harness.store.sheets().reduce((n, s) => n + s.items.length, 0),
        ).toBe(countBeforeSecondPaste);
      });

      it('Esc cancels a pending cut, restoring the line and clearing the clipboard', async () => {
        const harness = await grid();
        const doomed = harness.store.sheets()[0].items[0];

        tick(harness, [doomed]);
        await settle(harness.fixture);
        toolbarButton(harness.fixture, CUT_TITLE).click();
        await settle(harness.fixture);
        expect(isDimmed(harness.fixture, doomed.id)).toBe(true);

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await settle(harness.fixture);

        expect(harness.store.sheets()[0].items.map((i) => i.id)).toContain(doomed.id);
        expect(isDimmed(harness.fixture, doomed.id)).toBe(false);
        expect(toolbarButton(harness.fixture, PASTE_TITLE).disabled).toBe(true);
      });
    });

    it('Ctrl+C copies ticked lines instead of the cell block, and un-ticks them', async () => {
      const harness = await grid();
      const [beer] = harness.store.sheets()[0].items;

      tick(harness, [beer]);
      await settle(harness.fixture);

      // A tick takes priority: nothing lands on the system clipboard.
      expect(copyFrom(harness.fixture)).toBe('');
      expect(harness.api.getSelectedNodes().length).toBe(0);
    });

    it('Ctrl+V pastes the row clipboard instead of the cell block, when lines are ticked', async () => {
      const harness = await grid();
      const items = harness.store.sheets()[0].items;
      const [beer] = items;
      const before = items.length;

      tick(harness, [beer]);
      await settle(harness.fixture);
      toolbarButton(harness.fixture, COPY_TITLE).click();
      await settle(harness.fixture);

      // Copy un-ticked its source — re-tick to give Ctrl+V a target, the
      // same way the toolbar's own Paste button needs one.
      tick(harness, [beer]);
      await settle(harness.fixture);
      harness.fixture.nativeElement.dispatchEvent(clipboardEvent('paste'));
      await settle(harness.fixture);

      expect(harness.store.sheets()[0].items.length).toBe(before + 1);
    });

    it('Ctrl+X dims the ticked lines instead of cutting the cell block', async () => {
      const harness = await grid();
      const [beer] = harness.store.sheets()[0].items;
      const before = harness.store.sheets()[0].items.length;

      tick(harness, [beer]);
      await settle(harness.fixture);

      harness.fixture.nativeElement.dispatchEvent(clipboardEvent('cut'));
      await settle(harness.fixture);

      expect(harness.store.sheets()[0].items.length).toBe(before);
      expect(harness.store.sheets()[0].items.map((i) => i.id)).toContain(beer.id);
    });

    it('targets an empty sheet by clicking its own add-item row first, with no line to select a cell on', async () => {
      const harness = await grid();
      const beer = harness.store.sheets()[0].items[0];

      tick(harness, [beer]);
      await settle(harness.fixture);
      // Copy un-ticks on its own — nothing ticked or selected any more, so
      // Paste has nowhere to go until the add-item row of the new, empty
      // sheet says where.
      toolbarButton(harness.fixture, COPY_TITLE).click();
      await settle(harness.fixture);

      const empty = harness.store.addSheet('Empty');
      await settle(harness.fixture);

      expect(toolbarButton(harness.fixture, PASTE_TITLE).disabled).toBe(true);

      selecting(harness.fixture).onCellMouseDown(onCell(harness.api, `add-item:${empty.id}`, 'item'));
      await settle(harness.fixture);
      expect(toolbarButton(harness.fixture, PASTE_TITLE).disabled).toBe(false);

      toolbarButton(harness.fixture, PASTE_TITLE).click();
      await settle(harness.fixture);

      const emptyItems = harness.store.sheets().find((s) => s.id === empty.id)!.items;
      expect(emptyItems.length).toBe(1);
      expect(emptyItems[0].name).toBe(beer.name);
    });
  });

  /**
   * The selection block used to only move from a mouse — {@link
   * SplitGrid.onCellFocused}'s own bounce-away logic left it behind on
   * whatever cell was last clicked while the arrow keys moved AG Grid's own
   * focus on without it, so the ring stayed put and a later copy/paste read
   * the wrong cell. Excel's own arrow keys restart the block at wherever
   * focus lands, and Shift holds the anchor and drags just the far corner —
   * {@link SplitGrid.onCellKeyDown} is what makes the two match, off the real
   * `(cellKeyDown)` output rather than `(cellFocused)`: `navigateTo`, AG
   * Grid's own arrow-key handler, does not thread the keyboard event onto
   * `cellFocused` the way a click or a Tab does, so there is nothing there to
   * tell a keyboard-driven move apart from a mouse one that already set the
   * selection itself.
   */
  describe('arrow-key selection', () => {
    it('never lets a keyboard-driven focus move reach the header row', async () => {
      const harness = await grid();
      const { fixture, api, store } = harness;
      const item = store.sheets()[0].items[0];

      focusCell(api, `item:${item.id}`, 'item');
      pressKey(fixture, 'ArrowUp');
      await settle(fixture);

      expect(
        (fixture.nativeElement as HTMLElement).querySelector('.ag-header-cell-focus'),
      ).toBeNull();
    });

    it('stops at Item rather than reaching the Sheet column on the left', async () => {
      const harness = await grid();
      const { fixture, api, store } = harness;
      const item = store.sheets()[0].items[0];

      focusCell(api, `item:${item.id}`, 'item');
      pressKey(fixture, 'ArrowLeft');
      await settle(fixture);

      expect(api.getFocusedCell()?.column.getColId()).toBe('item');
    });

    it('reaches the add-item row on a plain arrow, the same as a click always could', async () => {
      const harness = await grid();
      const { fixture, api, store } = harness;
      const sheet = store.sheets()[0];
      const last = sheet.items.at(-1)!;

      focusCell(api, `item:${last.id}`, 'item');
      pressKey(fixture, 'ArrowDown');
      await settle(fixture);

      const focused = api.getFocusedCell();
      expect(focused && api.getDisplayedRowAtIndex(focused.rowIndex)?.id).toBe(
        `add-item:${sheet.id}`,
      );
    });

    it('drops the ring instead of leaving it behind when a plain arrow reaches the add-item row', async () => {
      const harness = await grid();
      const { fixture, api, store } = harness;
      const items = store.sheets()[0].items;
      const last = items.at(-1)!;

      // A real ring on the last line first — the same as a click would
      // leave — so there is something for the next arrow key to strand.
      focusCell(api, `item:${items.at(-2)!.id}`, 'item');
      pressKey(fixture, 'ArrowDown');
      await settle(fixture);
      expect(selectedCells(fixture)).toEqual([`item:${last.id}/item`]);

      pressKey(fixture, 'ArrowDown');
      await settle(fixture);

      // Focus really did move to the add-item row...
      const focused = api.getFocusedCell();
      expect(focused && api.getDisplayedRowAtIndex(focused.rowIndex)?.data?.kind).toBe('add-item');
      // ...and the last line's ring did not stay behind on it.
      expect(selectedCells(fixture)).toEqual([]);
    });

    it('skips the add-item row on a Shift+arrow instead of growing the block onto it', async () => {
      const harness = await grid();
      const { fixture, api, store } = harness;
      const sheet = store.sheets()[0];
      const last = sheet.items.at(-1)!;

      focusCell(api, `item:${last.id}`, 'item');
      // A real block first — a bare `focusCell` never sets `selection` on
      // its own (see the next test's own doc comment) — so there is
      // something for the Shift+arrow below to actually leave alone.
      pressKey(fixture, 'ArrowDown');
      await settle(fixture);
      pressKey(fixture, 'ArrowUp');
      await settle(fixture);
      pressKey(fixture, 'ArrowDown', { shiftKey: true });
      await settle(fixture);

      // Nothing past the add-item row to grow onto in this sample sheet, so
      // the block stays put — the add-item row itself is never in it.
      expect(selectedCells(fixture)).toEqual([`item:${last.id}/item`]);
      // AG Grid's own default navigation moves its focus onto the add-item
      // row before this handler ever runs; with nowhere further to grow,
      // that focus is put back onto the block's own head rather than left
      // stranded on the add-item row, which is what made the row read as
      // though it had joined the selection.
      const focused = api.getFocusedCell();
      expect(focused && api.getDisplayedRowAtIndex(focused.rowIndex)?.id).toBe(`item:${last.id}`);
    });

    it('carries a Shift+arrow on to the next sheet’s own first line, past its add-item row', async () => {
      const harness = await grid();
      const { fixture, api, store } = harness;
      const sheet1 = store.sheets()[0];
      const secondToLast = sheet1.items.at(-2)!;
      const last = sheet1.items.at(-1)!;
      const sheet2 = store.addSheet('Second sheet');
      const created = store.addItem(sheet2.id, 'Snack', 3);
      await settle(fixture);

      // A real anchor, the way a block actually grows — a bare `focusCell`
      // moves AG Grid's own focus without ever setting `selection` (nothing
      // here goes through `onCellKeyDown`), so a Shift+arrow straight off it
      // would just start a fresh single-cell block at wherever it landed,
      // proving nothing about a block that already spans several rows.
      focusCell(api, `item:${secondToLast.id}`, 'item');
      pressKey(fixture, 'ArrowDown');
      await settle(fixture);
      pressKey(fixture, 'ArrowDown', { shiftKey: true });
      await settle(fixture);

      const focused = api.getFocusedCell();
      expect(focused && api.getDisplayedRowAtIndex(focused.rowIndex)?.id).toBe(
        `item:${created.id}`,
      );
      // The block's own rectangle runs straight through the add-item row's
      // row index on the way from the last line of sheet 1 to the first of
      // sheet 2 — this is what proves that row never paints as selected
      // despite falling inside it.
      expect(selectedCells(fixture).sort()).toEqual(
        [`item:${last.id}/item`, `item:${created.id}/item`].sort(),
      );
    });

    it('follows a plain arrow key to the cell it lands on', async () => {
      const harness = await grid();
      const { fixture, api, store } = harness;
      const items = store.sheets()[0].items;

      focusCell(api, `item:${items[0].id}`, 'item');
      pressKey(fixture, 'ArrowDown');
      await settle(fixture);

      expect(selectedCells(fixture)).toEqual([`item:${items[1].id}/item`]);
    });

    it('moves across columns on a plain Left/Right arrow', async () => {
      const harness = await grid();
      const { fixture, api, store } = harness;
      const item = store.sheets()[0].items[0];

      focusCell(api, `item:${item.id}`, 'item');
      pressKey(fixture, 'ArrowRight');
      await settle(fixture);

      expect(selectedCells(fixture)).toEqual([`item:${item.id}/amount`]);
    });

    it('extends the block on a Shift+arrow instead of moving it', async () => {
      const harness = await grid();
      const { fixture, api, store } = harness;
      const items = store.sheets()[0].items;

      focusCell(api, `item:${items[0].id}`, 'item');
      pressKey(fixture, 'ArrowDown');
      await settle(fixture);

      pressKey(fixture, 'ArrowDown', { shiftKey: true });
      await settle(fixture);

      // The anchor from the plain arrow above stays put — Shift only grows
      // the block down to the new row, it does not restart it there.
      expect(selectedCells(fixture).sort()).toEqual(
        [`item:${items[1].id}/item`, `item:${items[2].id}/item`].sort(),
      );
    });

    it('drops back to a single cell on the next plain arrow after Shift extended it', async () => {
      const harness = await grid();
      const { fixture, api, store } = harness;
      const items = store.sheets()[0].items;

      focusCell(api, `item:${items[0].id}`, 'item');
      pressKey(fixture, 'ArrowDown');
      pressKey(fixture, 'ArrowDown', { shiftKey: true });
      await settle(fixture);

      pressKey(fixture, 'ArrowDown');
      await settle(fixture);

      expect(selectedCells(fixture)).toEqual([`item:${items[3].id}/item`]);
    });
  });

  /**
   * The fill handle — the little square at a selection's own corner that
   * repeats its value, or a block's pattern, into whatever it is dragged
   * over. AG Grid's own is Enterprise, so this is the component's, built the
   * same way the selection and clipboard are — see `cell-range.spec.ts` for
   * the rectangle it grows by.
   */
  describe('the fill handle', () => {
    function fillHandleCells(fixture: ComponentFixture<SplitGrid>): string[] {
      return Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll('.ledger-fill-handle'),
      ).map(
        (cell) =>
          `${cell.closest('.ag-row')!.getAttribute('row-id')}/${cell.getAttribute('col-id')}`,
      );
    }

    it('sits at the selection’s own bottom-right corner, and nowhere else', async () => {
      const harness = await grid();
      const [beer, pizza] = harness.store.sheets()[0].items;

      drag(harness, [`item:${beer.id}`, 'item'], [`item:${pizza.id}`, 'amount']);
      await settle(harness.fixture);

      expect(fillHandleCells(harness.fixture)).toEqual([`item:${pizza.id}/amount`]);
    });

    it('draws no handle on the row that adds a new line', async () => {
      const harness = await grid();
      const sheet = harness.store.sheets()[0];

      drag(harness, [`add-item:${sheet.id}`, 'item'], [`add-item:${sheet.id}`, 'item']);
      await settle(harness.fixture);

      expect(fillHandleCells(harness.fixture)).toEqual([]);
    });

    it('draws no handle on the padding under a short block', async () => {
      const harness = await grid();
      harness.store.addSheet('Nothing yet');
      await settle(harness.fixture);

      const filler = (harness.fixture.nativeElement as HTMLElement).querySelector(
        '.ag-row.ledger-filler-row',
      )!;
      const fillerRowId = filler.getAttribute('row-id')!;

      drag(harness, [fillerRowId, 'item'], [fillerRowId, 'item']);
      await settle(harness.fixture);

      expect(fillHandleCells(harness.fixture)).toEqual([]);
    });

    it('does not dash the add row or the padding while a drag passes over them', async () => {
      const harness = await grid();
      const sheet = harness.store.sheets()[0];
      const last = sheet.items.at(-1)!;

      drag(harness, [`item:${last.id}`, 'amount'], [`item:${last.id}`, 'amount']);
      await settle(harness.fixture);
      const grid_ = selecting(harness.fixture);
      grid_.startFill(
        (onCell(harness.api, `item:${last.id}`, 'amount') as { node: unknown }).node,
        'amount',
      );
      grid_.onCellMouseOver(onCell(harness.api, `add-item:${sheet.id}`, 'amount'));
      await settle(harness.fixture);

      expect(
        (harness.fixture.nativeElement as HTMLElement).querySelectorAll('.ledger-fill-preview')
          .length,
      ).toBe(0);

      grid_.endDrag();
      // Nothing to fill — the whole drag never left the padding.
      expect(harness.store.sheets()[0].items.length).toBe(sheet.items.length);
    });

    it('repeats a single cell down the column it is dragged over', async () => {
      const harness = await grid();
      const [beer, pizza, burger] = harness.store.sheets()[0].items;

      drag(harness, [`item:${beer.id}`, 'amount'], [`item:${beer.id}`, 'amount']);
      await settle(harness.fixture);
      fillDrag(harness, [`item:${beer.id}`, 'amount'], [`item:${burger.id}`, 'amount']);
      await settle(harness.fixture);

      const after = harness.store.sheets()[0].items;
      expect(after.find((i) => i.id === pizza.id)!.amount).toBe(beer.amount);
      expect(after.find((i) => i.id === burger.id)!.amount).toBe(beer.amount);
    });

    it('repeats a block’s own pattern, tiled, across the rows it grows into', async () => {
      const harness = await grid();
      const [beer, pizza, burger, steak] = harness.store.sheets()[0].items;

      drag(harness, [`item:${beer.id}`, 'item'], [`item:${pizza.id}`, 'amount']);
      await settle(harness.fixture);
      fillDrag(harness, [`item:${pizza.id}`, 'amount'], [`item:${steak.id}`, 'amount']);
      await settle(harness.fixture);

      const after = harness.store.sheets()[0].items;
      expect(after.find((i) => i.id === burger.id)!.name).toBe(beer.name);
      expect(after.find((i) => i.id === burger.id)!.amount).toBe(beer.amount);
      expect(after.find((i) => i.id === steak.id)!.name).toBe(pizza.name);
      expect(after.find((i) => i.id === steak.id)!.amount).toBe(pizza.amount);
    });

    it('writes through the same rules typing does, sharing a paste’s validation', async () => {
      const harness = await grid();
      const items = harness.store.sheets()[0].items;
      const person = harness.store.people()[0];

      // Beer's share is already inside the workbook's 0 – 10 validation, so
      // fill and share it as any valid value would be.
      drag(
        harness,
        [`item:${items[0].id}`, `person:${person.id}`],
        [`item:${items[0].id}`, `person:${person.id}`],
      );
      await settle(harness.fixture);
      fillDrag(
        harness,
        [`item:${items[0].id}`, `person:${person.id}`],
        [`item:${items[1].id}`, `person:${person.id}`],
      );
      await settle(harness.fixture);

      expect(harness.store.share(items[1].id, person.id)).toEqual(
        harness.store.share(items[0].id, person.id),
      );
    });

    it('clips to the lines that exist rather than growing the sheet', async () => {
      const harness = await grid();
      const sheet = harness.store.sheets()[0];
      const last = sheet.items.at(-1)!;
      const before = sheet.items.length;

      drag(harness, [`item:${last.id}`, 'amount'], [`item:${last.id}`, 'amount']);
      await settle(harness.fixture);
      fillDrag(harness, [`item:${last.id}`, 'amount'], [`add-item:${sheet.id}`, 'amount']);
      await settle(harness.fixture);

      expect(harness.store.sheets()[0].items.length).toBe(before);
    });

    it('grows the selection to cover what it just filled', async () => {
      const harness = await grid();
      const [beer, pizza, burger] = harness.store.sheets()[0].items;

      drag(harness, [`item:${beer.id}`, 'amount'], [`item:${beer.id}`, 'amount']);
      await settle(harness.fixture);
      fillDrag(harness, [`item:${beer.id}`, 'amount'], [`item:${burger.id}`, 'amount']);
      await settle(harness.fixture);

      expect(selectedCells(harness.fixture).sort()).toEqual(
        [
          `item:${beer.id}/amount`,
          `item:${pizza.id}/amount`,
          `item:${burger.id}/amount`,
        ].sort(),
      );
    });

    it('does nothing when the handle is dropped back inside the selection', async () => {
      const harness = await grid();
      const [beer, pizza] = harness.store.sheets()[0].items;
      const before = pizza.amount;

      drag(harness, [`item:${beer.id}`, 'amount'], [`item:${pizza.id}`, 'amount']);
      await settle(harness.fixture);
      fillDrag(harness, [`item:${pizza.id}`, 'amount'], [`item:${beer.id}`, 'amount']);
      await settle(harness.fixture);

      expect(harness.store.sheets()[0].items.find((i) => i.id === pizza.id)!.amount).toBe(
        before,
      );
      expect(selectedCells(harness.fixture).sort()).toEqual(
        [`item:${beer.id}/amount`, `item:${pizza.id}/amount`].sort(),
      );
    });
  });

  it('leaves the blank row alone when nothing is typed', async () => {
    const { store, api } = await grid();

    const sheet = store.sheets()[0];
    const before = sheet.items.length;

    api.getRowNode(`add-item:${sheet.id}`)!.setDataValue('item', '   ');

    expect(store.sheets()[0].items.length).toBe(before);
  });

  describe('undo and redo', () => {
    function undoButton(fixture: ComponentFixture<SplitGrid>): HTMLButtonElement {
      return (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
        '.toolbar-btn[title="Undo (Ctrl+Z)"]',
      )!;
    }

    function redoButton(fixture: ComponentFixture<SplitGrid>): HTMLButtonElement {
      return (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
        '.toolbar-btn[title="Redo (Ctrl+Y)"]',
      )!;
    }

    /** A real, bubbling keydown — same rationale as {@link pressKey} above:
     * calling `onKeyDown` directly would prove nothing about whether Ctrl+Z
     * actually reaches the host listener from wherever focus happens to be. */
    function ctrlKey(target: Element, key: string, extra: KeyboardEventInit = {}): void {
      target.dispatchEvent(
        new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true, ...extra }),
      );
    }

    it('disables both toolbar buttons until there is history to move through', async () => {
      const { fixture, store } = await grid();
      expect(undoButton(fixture).disabled).toBe(true);
      expect(redoButton(fixture).disabled).toBe(true);

      store.addPerson('Wednesday');
      await settle(fixture);

      expect(undoButton(fixture).disabled).toBe(false);
      expect(redoButton(fixture).disabled).toBe(true);
    });

    it('undoes and redoes a store edit from the toolbar buttons', async () => {
      const { fixture, store } = await grid();
      const before = store.people().length;

      store.addPerson('Wednesday');
      await settle(fixture);

      undoButton(fixture).click();
      await settle(fixture);
      expect(store.people().length).toBe(before);
      expect(undoButton(fixture).disabled).toBe(true);
      expect(redoButton(fixture).disabled).toBe(false);

      redoButton(fixture).click();
      await settle(fixture);
      expect(store.people().length).toBe(before + 1);
    });

    it('undoes with Ctrl+Z when a cell is focused but not being edited', async () => {
      const { fixture, store, api } = await grid();
      const before = store.people().length;
      store.addPerson('Wednesday');
      await settle(fixture);

      const item = store.sheets()[0].items[0];
      focusCell(api, `item:${item.id}`);
      await settle(fixture);
      const cell = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.ag-cell-focus')!;

      ctrlKey(cell, 'z');
      await settle(fixture);

      expect(store.people().length).toBe(before);
    });

    it('redoes with Ctrl+Y', async () => {
      const { fixture, store, api } = await grid();
      const before = store.people().length;
      store.addPerson('Wednesday');
      store.undo();
      await settle(fixture);
      expect(store.people().length).toBe(before);

      const item = store.sheets()[0].items[0];
      focusCell(api, `item:${item.id}`);
      await settle(fixture);
      const cell = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.ag-cell-focus')!;

      ctrlKey(cell, 'y');
      await settle(fixture);
      expect(store.people().length).toBe(before + 1);
    });

    it('redoes with Ctrl+Shift+Z', async () => {
      const { fixture, store, api } = await grid();
      const before = store.people().length;
      store.addPerson('Wednesday');
      store.undo();
      await settle(fixture);

      const item = store.sheets()[0].items[0];
      focusCell(api, `item:${item.id}`);
      await settle(fixture);
      const cell = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.ag-cell-focus')!;

      ctrlKey(cell, 'z', { shiftKey: true });
      await settle(fixture);
      expect(store.people().length).toBe(before + 1);
    });

    it('leaves Ctrl+Z to the browser while a name box is being typed into', async () => {
      const { fixture, store } = await grid();
      store.addPerson('Wednesday');
      await settle(fixture);
      expect(store.canUndo()).toBe(true);

      const input = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
        '.masthead-cell input.title-input',
      )!;
      ctrlKey(input, 'z');
      await settle(fixture);

      // Still there to undo — the app-level handler never ran.
      expect(store.canUndo()).toBe(true);
    });
  });
});
