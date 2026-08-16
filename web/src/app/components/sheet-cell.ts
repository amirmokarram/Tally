/**
 * The Sheet column's cell — the block heading for a group of item rows, and
 * where the sheet is named and charged.
 *
 * A spanned cell is as tall as its block, which is room enough for the settings
 * reached for most: the name, and tax, tip and discount. They are boxes here
 * rather than a trip to a panel, the same way a person is named from their
 * column header.
 *
 * They are turned a quarter turn to be read from the bottom up, so the block's
 * *height* is what the name is written along and the column costs the ledger
 * only the thickness of three lines of text — 70 pixels where it used to take
 * 190. The column header is gone with it: a one-word label over a spine this
 * narrow would have to be turned on its side too, and the names underneath
 * already say what the column is.
 *
 * The panel stays, and still holds the charges too. It is the long form — the
 * one place with room to say *amount or percent* in words rather than expecting
 * you to know that a trailing `%` switches between them — and the only place
 * for what will not fit in a spine: currency, exchange rate, who paid, and
 * deleting the sheet. `⋯` opens it.
 *
 * {@link AddSheetHeader} sits at the top of the same column: adding a sheet is
 * what this column is *for*, so the button belongs at the head of it rather than
 * in the toolbar over the grid.
 */

import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { ICellRendererAngularComp, IHeaderAngularComp } from 'ag-grid-angular';
import { ICellRendererParams, IHeaderParams } from 'ag-grid-community';

import { TripStore } from '../core/trip-store';
import { ExpenseSheet, formatCharge, parseCharge } from '../models/trip.model';
import { LedgerRowData, ledgerBlockSize, sheetCaption } from './ledger-model';
import { LEDGER_ADD_ROW_HEIGHT, LEDGER_ROW_HEIGHT } from './grid-theme';

type ChargeKind = 'tax' | 'tip' | 'discount';

/**
 * Passed down through `cellRendererParams`. The grid, not the cell, owns the
 * editor panel — a popup rendered inside a cell would be clipped by the grid's
 * viewport, and AG Grid's own cell editors are unavailable on a spanned column.
 */
export interface SheetCellParams extends ICellRendererParams<LedgerRowData> {
  openEditor(sheetId: string): void;
  /**
   * Whether this sheet's add-item row is currently being edited — full
   * height rather than collapsed — see the height `effect()` below, which
   * needs it to know the block's *actual* current height rather than
   * assuming every row in it is {@link LEDGER_ROW_HEIGHT}.
   */
  isAddRowEditing(sheetId: string): boolean;
  /**
   * Whether the grid is mid-PNG-capture (`SplitGrid.capturing`) — the add-item
   * row this cell's own height otherwise budgets for isn't rendered at all
   * during one (see `printRows`, `split-grid.ts`), so the height `effect()`
   * below needs to know to leave that row's height out of the sum entirely
   * rather than assuming it is still there, collapsed or otherwise.
   */
  isCapturing(): boolean;
}

@Component({
  selector: 'app-sheet-cell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[style.background-color]': 'tint()',
  },
  template: `
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
            <div class="charge-field">
              <span class="charge-label" aria-hidden="true">{{ field.label }}</span>
              <input
                type="text"
                inputmode="decimal"
                placeholder="?"
                [attr.aria-label]="field.label + ' for this sheet'"
                [value]="charge(field.kind)"
                (change)="setCharge(field.kind, $event)"
                (keydown)="keepKey($event)"
                (keydown.enter)="commit($event)"
              />
            </div>
          }
        </div>
      }
    }
  `,
  styles: `
    /* The quarter turn: \`sideways-lr\` lays every line on its side and reads it
       from the bottom up in one step, with lines stacking left to right — the
       name at the column's left edge, the charges next. The
       older \`vertical-rl\` plus a \`rotate(180deg)\` this used to take was a
       stand-in for browsers that lacked \`sideways-lr\` outright; current
       Chrome and Safari render it directly, and without the transform, the
       host's own box is measured for the width it actually has rather than
       one it has to be told about after the fact. */
    :host {
      display: block;
      writing-mode: sideways-lr;
      /* The cell is stretched to the block and the boxes to the cell. A
         floor under AG Grid's own row-based height (set imperatively in
         the effect() below) — short/empty sheets read as this tall at
         minimum, while a sheet with enough rows keeps growing past it. */
      width: 100%;
      height: 100%;
      min-height: 155px;
      overflow: hidden;
      line-height: 1.35;
      padding: 4px 2px;
      /* Two lines of boxes and a caption have to sit across a column 50 pixels
         wide, which is what the turn bought. */
      font-size: 12px;
      /* The tint (bound above) is always one of the two dark blues in
         --sheet-tint / --navy-800, so white is the one text colour this
         whole cell needs — everything below just dims it rather than
         switching hue, the same "quiet on navy" idiom the header's own
         column border and the add-sheet/add-person icon buttons use. */
      color: var(--text-invert);
    }

    .line {
      display: flex;
      align-items: center;
      gap: 2px;
    }

    /* The boxes read as text until they are reached for, the same way a
       person's name does in its header. Nothing here should look like a form
       until someone wants it to be one.

       Sized logically, not physically: a box's inline size is its length *down*
       the cell now, and \`min-width: 0\` would squeeze the wrong side of it. */
    input {
      min-inline-size: 0;
      /* As long as a box needs to be, rather than as long as the block is: with
         every box stretched to fill it, a sheet of twenty lines was a name box
         twenty lines long. Both exceptions are below — the name, which *is* the
         heading and takes what the line has, and the charges, which share a
         short line rather than standing at 50 and losing the last of the three
         over the cell's edge. */
      height: 50px;
      flex-shrink: 0;
      /* — and never longer than the cell holding it, whatever the block does.
         Nothing reaches this now a block is four rows at the least (see
         \`MIN_BLOCK_ROWS\`), and it is what stands between a box and being sawn
         off by the cell's edge if either figure is ever changed. */
      max-height: 100%;
      padding: 2px 0px;
      border: 1px solid transparent;
      border-radius: 3px;
      background: transparent;
      color: inherit;
      font: inherit;

      &::placeholder {
        color: rgb(255 255 255 / 55%);
      }

      /* Matches person-header.ts's own input: a hint of border on hover so
         the box reads as editable before you click into it. */
      &:hover {
        border-color: rgb(255 255 255 / 35%);
      }

      /* Matches person-header.ts's own input: the box does not switch to a
         separate white surface on focus — its border turns solid white and
         its background gets a translucent white wash, staying on the
         cell's own tint rather than a border-width change (that's what
         made focus reflow the whole cell earlier — see split-grid.ts). */
      &:focus {
        outline: none;
        border-color: var(--text-invert);
        background: rgb(255 255 255 / 12%);
      }
    }

    /* The one box that takes the block rather than a fixed length: it is the
       heading, and a name is as long as it is. \`flex: 1\` overrides the 50
       above — the basis is what the line has left once \`⋯\` has its 18. */
    .name {
      flex: 1;
      text-align: center;
      font-weight: 600;
      font-size: 18px;

      /* The ordinary --credit red is tuned for a white background and goes
         near-illegible on the tint; this is that same red, lightened to
         read against --sheet-tint / --navy-800 instead. */
      &.has-error {
        color: #ffb4a8;
      }
    }

    /* Tax, tip and discount down one line: three fields fit where three
       labelled rows would not. Each pairs a small caption with its box —
       shrinking the box from 50px to 27px is what buys the room for the
       caption without lengthening the line, so the amount still reads as
       what it is after it's typed rather than only while the placeholder
       shows. */
    .charges {
      display: flex;
      gap: 2px;
      margin-block-start: 1px;
      border-left: 1px solid #ffffff17;
      font-size: 11px;

      /* Each field's own caption-then-box pair, laid out along the same
         axis as \`.charges\` itself (the default \`flex-direction: row\`
         follows the writing mode's inline axis, the "down the cell"
         direction) so the caption sits before its box in reading order
         rather than beside it across the column's width. */
      .charge-field {
        display: flex;
        align-items: center;
        flex-shrink: 1;
      }

      .charge-label {
        flex: none;
        padding-inline: 2px;
        color: rgb(255 255 255 / 65%);
        font-size: 11px;
        white-space: nowrap;
      }

      /* The other exception to the fixed length above: three boxes want 154 of
         line and the shortest block there is gives 141, so these share what is
         there rather than standing at 50 and losing the last of the three to
         the cell's edge. A charge is two to four characters and reads short at
         46; a name does not. */
      input {
        flex-shrink: 1;
        height: 27px;
        font-variant-numeric: tabular-nums;
      }
    }

    /* Same dim-then-full-opacity convention as the add-sheet / add-person
       header buttons, rather than the colour-shift a white cell used. */
    .more {
      flex: none;
      border: none;
      background: transparent;
      color: var(--text-invert);
      opacity: 0.5;
      padding-inline: 3px;
      font-size: 14px;
      line-height: 1;
      cursor: pointer;

      &:hover,
      &:focus-visible {
        opacity: 1;
      }
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
      if (rows <= 1) {
        cell.style.height = '';
        return;
      }
      // Every row in the block is `LEDGER_ROW_HEIGHT` *except* the block's
      // own add-item row — which isn't rendered at all during a PNG capture
      // (`isCapturing`, `printRows` in `split-grid.ts`), and otherwise is
      // short until it's being edited (`getRowHeight` in `split-grid.ts`).
      // Reading these here, rather than just multiplying by `rows`, is what
      // keeps this cell's height in step with that row's real one — both
      // read a signal on the grid itself, so this effect reruns on its own
      // when either changes, no extra refresh needed.
      const addRowHeight = this.params?.isCapturing()
        ? 0
        : this.params?.isAddRowEditing(sheet.id)
          ? LEDGER_ROW_HEIGHT
          : LEDGER_ADD_ROW_HEIGHT;
      cell.style.height = `${(rows - 1) * LEDGER_ROW_HEIGHT + addRowHeight - 1}px`;
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

  protected sheet(): ExpenseSheet | undefined {
    const data = this.data();
    if (!data) {
      return undefined;
    }
    return this.store.sheets().find((s) => s.id === data.sheetId);
  }

  /**
   * The cell's own background — alternates by the sheet's position in the
   * trip, not by row, so the tint marks a whole block regardless of how
   * many lines are in it (a row-level stripe would cut across the block and
   * could land the same shade on two sheets in a row).
   */
  protected tint(): string | undefined {
    const sheet = this.sheet();
    if (!sheet) {
      return undefined;
    }
    const index = this.store.sheets().findIndex((s) => s.id === sheet.id);
    return index % 2 === 0 ? 'var(--sheet-tint)' : 'var(--navy-800)';
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

/** Passed down through `headerComponentParams` — see {@link AddSheetHeader}. */
export interface AddSheetHeaderParams extends IHeaderParams<LedgerRowData> {
  addSheet(): void;
}

/**
 * The Sheet column's header: the button that adds a sheet.
 *
 * A sheet is a block of this column, so this is the head of the thing it makes —
 * which is worth more than the word "Add expense sheet" was in the toolbar. The
 * column is 70 pixels wide and its names are written on their side, so there is
 * no room for the label anyway: the icon is the whole button, and the
 * tooltip and the accessible name carry the words.
 *
 * Styled and iconed to match {@link AddPersonHeader} — the same plus, borderless,
 * dimmed to 0.5 opacity at rest and full at hover/focus — rather than the
 * bordered, surface-filled button this used to draw: two "add" affordances on
 * the same navy header band read as one family now, not two different shapes
 * or weights of button.
 *
 * Adding a sheet from a *row* at the bottom of the grid was the first design,
 * and AG Grid renders no cell for it in a spanned column — see the note in
 * `ledger-model.ts`.
 */
@Component({
  selector: 'app-add-sheet-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      title="Add expense sheet"
      aria-label="Add expense sheet"
      (click)="add()"
    >
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
        <path
          d="M8 3.25v9.5M3.25 8h9.5"
          fill="none"
          stroke="currentColor"
          stroke-width="1.75"
          stroke-linecap="round"
        />
      </svg>
    </button>
  `,
  styles: `
    :host {
      display: flex;
      align-items: center;
      justify-content: center;
      /* Centred on the column, which the cells below fill edge to edge — the
         header cell's own side padding is taken off in \`split-grid.ts\`. */
      width: 100%;
      height: 100%;
    }

    /* White, not \`--navy-800\`: the header itself is that navy, so the icon
       needs the header's *text* colour (\`--text-invert\`) to read against it
       at all — the same reasoning as \`AddPersonHeader\`'s own button. */
    button {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 26px;
      height: 26px;
      padding: 0;
      border: none;
      border-radius: 6px;
      background: transparent;
      color: var(--text-invert);
      opacity: 0.5;
      cursor: pointer;
      transition: opacity 120ms;

      &:hover,
      &:focus-visible {
        opacity: 1;
      }

      &:focus-visible {
        outline: 2px solid var(--text-invert);
        outline-offset: 1px;
      }
    }
  `,
})
export class AddSheetHeader implements IHeaderAngularComp {
  private params?: AddSheetHeaderParams;

  agInit(params: AddSheetHeaderParams): void {
    this.params = params;
  }

  refresh(params: AddSheetHeaderParams): boolean {
    this.params = params;
    return true;
  }

  protected add(): void {
    this.params?.addSheet();
  }
}
