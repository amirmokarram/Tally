/**
 * The Sheet column's cell — the block heading for a group of item rows, and
 * where the sheet is named and charged.
 *
 * A spanned cell is as tall as its block, which is room enough for the settings
 * reached for most: the name, and tax, tip and discount. They are boxes here
 * rather than a trip to a panel, the same way a person is named from their
 * column header.
 *
 * The panel stays, and still holds the charges too. It is the long form — the
 * one place with room to say *amount or percent* in words rather than expecting
 * you to know that a trailing `%` switches between them — and the only place
 * for what will not fit in 190 pixels: currency, exchange rate, who paid, and
 * deleting the sheet. `⋯` opens it.
 *
 * The Sheet column is present on every kind of row, so this also draws the
 * label for the pinned summary strip.
 */

import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { ICellRendererAngularComp } from 'ag-grid-angular';
import { ICellRendererParams } from 'ag-grid-community';

import { TripStore } from '../core/trip-store';
import { ExpenseSheet, formatCharge, parseCharge } from '../models/trip.model';
import { LedgerRowData, ledgerBlockSize, sheetCaption } from './ledger-model';
import { LEDGER_ROW_HEIGHT } from './grid-theme';

type ChargeKind = 'tax' | 'tip' | 'discount';

/**
 * Passed down through `cellRendererParams`. The grid, not the cell, owns the
 * editor panel — a popup rendered inside a cell would be clipped by the grid's
 * viewport, and AG Grid's own cell editors are unavailable on a spanned column.
 */
export interface SheetCellParams extends ICellRendererParams<LedgerRowData> {
  openEditor(sheetId: string): void;
}

@Component({
  selector: 'app-sheet-cell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @switch (kind()) {
      @case ('balances') {
        <span class="balance-label">Totals</span>
      }
      @default {
        @if (sheet(); as sheet) {
          <div class="line">
            <input
              class="name"
              type="text"
              placeholder="Sheet name"
              aria-label="Sheet name"
              [class.has-error]="hasError()"
              [value]="sheet.name"
              (input)="rename($event)"
              (keydown)="keepKey($event)"
              (keydown.enter)="commit($event)"
            />
            <button
              class="more"
              type="button"
              title="Currency, exchange rate, who paid — and deleting the sheet"
              aria-label="More settings for this sheet"
              (click)="openEditor()"
            >
              ⋯
            </button>
          </div>

          <!-- Charges are spread across the sheet's lines in proportion to
               price, so with no lines there is nothing for them to land on. -->
          @if (sheet.items.length) {
            <div class="charges" [title]="chargeHint()">
              @for (field of CHARGES; track field.kind) {
                <input
                  type="text"
                  inputmode="decimal"
                  [placeholder]="field.label"
                  [attr.aria-label]="field.label + ' for this sheet'"
                  [value]="charge(field.kind)"
                  (change)="setCharge(field.kind, $event)"
                  (keydown)="keepKey($event)"
                  (keydown.enter)="commit($event)"
                />
              }
            </div>
          }

          @if (payers(); as text) {
            <span class="caption">Paid by {{ text }}</span>
          }
        }
      }
    }
  `,
  styles: `
    :host {
      display: block;
      line-height: 1.35;
      padding: 5px 0;
      /* Two rows of boxes and a caption have to sit inside the shortest block
         there can be — a sheet of one line, which is two rows tall. */
      font-size: 12px;
    }

    .line {
      display: flex;
      align-items: center;
      gap: 2px;
    }

    /* The boxes read as text until they are reached for, the same way a
       person's name does in its header. Nothing here should look like a form
       until someone wants it to be one. */
    input {
      min-width: 0;
      padding: 1px 3px;
      border: 1px solid transparent;
      border-radius: 3px;
      background: transparent;
      color: inherit;
      font: inherit;

      &::placeholder {
        color: var(--text-muted);
        opacity: 0.75;
      }

      &:hover {
        border-color: var(--border-strong);
      }

      &:focus {
        outline: none;
        border-color: var(--navy-700);
        background: var(--surface);
      }
    }

    .name {
      flex: 1;
      font-weight: 600;
      font-size: 13px;
      color: var(--navy-800);

      &.has-error {
        color: var(--credit);
      }
    }

    /* Tax, tip and discount across one line: three boxes fit where three
       labelled rows would not, and the placeholder names each while it is
       empty. */
    .charges {
      display: flex;
      gap: 2px;
      margin-top: 1px;

      input {
        width: 0;
        flex: 1;
        font-variant-numeric: tabular-nums;
      }
    }

    /* Quiet until the cell is under the pointer: the sheet name is what the
       eye comes here for. */
    .more {
      flex: none;
      border: none;
      background: transparent;
      color: var(--text-muted);
      padding: 0 3px;
      font-size: 14px;
      line-height: 1;
      cursor: pointer;
      opacity: 0;
      transition: opacity 120ms;

      &:hover,
      &:focus-visible {
        opacity: 1;
        color: var(--navy-800);
      }
    }

    :host(:hover) .more {
      opacity: 1;
    }

    .caption {
      display: block;
      font-size: 11px;
      color: var(--text-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .balance-label {
      font-size: 13px;
      font-weight: 550;
      color: var(--text-muted);
    }
  `,
})
export class SheetCell implements ICellRendererAngularComp {
  private readonly store = inject(TripStore);

  private readonly data = signal<LedgerRowData | undefined>(undefined);
  private readonly cell = signal<HTMLElement | undefined>(undefined);
  private params?: SheetCellParams;

  constructor() {
    // AG Grid sizes a spanned cell exactly once, when its controller is built,
    // and never again — so a sheet's merged cell keeps the height its block had
    // at that moment, and every line added to the sheet afterwards falls
    // outside it. (`SpannedCellCtrl` assigns its `cellSpan` *after* calling
    // `super()`, by which point the base `CellCtrl` has already asked for it,
    // seen nothing, and skipped subscribing to the events that would resize the
    // cell later. Still there in 36.0.2, the newest release.)
    //
    // Which rows are merged AG Grid does recalculate correctly; it is only the
    // pixel height that goes stale, so re-applying it here is the whole fix.
    effect(() => {
      const cell = this.cell();
      const sheet = this.sheet();
      if (!cell || !sheet) {
        return;
      }
      const rows = ledgerBlockSize(sheet);
      // A one-row block is not merged at all, and a cell AG Grid is sizing
      // itself must be left to do so.
      cell.style.height = rows > 1 ? `${rows * LEDGER_ROW_HEIGHT - 1}px` : '';
    });
  }

  agInit(params: SheetCellParams): void {
    this.params = params;
    this.data.set(params.data);
    this.cell.set(params.eGridCell);
  }

  refresh(params: SheetCellParams): boolean {
    this.params = params;
    this.data.set(params.data);
    this.cell.set(params.eGridCell);
    // Handled in place — returning false would make AG Grid destroy and
    // recreate the component on every recalculation.
    return true;
  }

  protected kind(): string {
    return this.data()?.kind ?? 'item';
  }

  protected sheet(): ExpenseSheet | undefined {
    const data = this.data();
    if (!data || data.kind === 'balances') {
      return undefined;
    }
    return this.store.sheets().find((s) => s.id === data.sheetId);
  }

  // --- Editing the sheet in place ----------------------------------------

  protected readonly CHARGES = [
    { kind: 'tax', label: 'Tax' },
    { kind: 'tip', label: 'Tip' },
    { kind: 'discount', label: 'Disc' },
  ] as const satisfies readonly { kind: ChargeKind; label: string }[];

  protected rename(event: Event): void {
    const sheet = this.sheet();
    if (sheet) {
      this.store.renameSheet(sheet.id, (event.target as HTMLInputElement).value);
    }
  }

  /** What is in a charge box: the text that was typed, not the money it makes. */
  protected charge(kind: ChargeKind): string {
    const sheet = this.sheet();
    return sheet ? formatCharge(sheet[kind]) : '';
  }

  /**
   * Takes a charge on commit rather than on every keystroke.
   *
   * The box holds text and the sheet holds a parsed `Charge`, and the round
   * trip between them is lossy — `0` comes back as empty, `5.610` as `5.61`. On
   * each keystroke that rewrites the box under the caret; on blur or Enter it
   * is just the value settling.
   *
   * Anything that will not parse is left alone, so a half-typed figure is never
   * turned into a charge of nothing.
   */
  protected setCharge(kind: ChargeKind, event: Event): void {
    const sheet = this.sheet();
    const input = event.target as HTMLInputElement;
    const charge = parseCharge(input.value);
    if (!sheet) {
      return;
    }
    if (charge) {
      this.store.setCharge(sheet.id, kind, charge);
    } else {
      input.value = formatCharge(sheet[kind]);
    }
  }

  /** The charges as money, for the boxes that hold them as text. */
  protected chargeHint(): string {
    const sheet = this.sheet();
    const caption = sheet
      ? sheetCaption(this.store.split().sheetTotals.get(sheet.id))
      : '';
    return caption
      ? `${caption} — a plain number, or a percentage like 15%`
      : 'Tax, tip and discount — a plain number, or a percentage like 15%';
  }

  /**
   * Keeps a keystroke out of the grid.
   *
   * AG Grid listens for keys across the whole cell, and would read the arrows
   * as "move to the next cell" while the caret is being moved inside a box.
   * Enter also blurs, which clears the grid's idea of what is focused out from
   * under the event still travelling towards it.
   */
  protected keepKey(event: Event): void {
    event.stopPropagation();
  }

  protected commit(event: Event): void {
    (event.target as HTMLInputElement).blur();
  }

  protected payers(): string {
    const sheet = this.sheet();
    if (!sheet?.paidBy.length) {
      return '';
    }
    const people = this.store.people();
    return sheet.paidBy
      .map((id) => people.find((p) => p.id === id)?.name || 'Unnamed')
      .join(', ');
  }

  protected hasError(): boolean {
    const sheet = this.sheet();
    if (!sheet) {
      return false;
    }
    return (this.store.issuesBySheet().get(sheet.id) ?? []).some(
      (i) => i.severity === 'error',
    );
  }

  protected openEditor(): void {
    const data = this.data();
    if (data && 'sheetId' in data) {
      this.params?.openEditor(data.sheetId);
    }
  }
}
