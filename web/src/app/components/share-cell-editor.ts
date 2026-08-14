/**
 * The share cell's own editor, in place of AG Grid's plain text one.
 *
 * A real live mask, not just a placeholder: the cell always reads `owe|pay`
 * — even mid-edit, as `_|_`, `2|_`, `2|1` — and the pipe is never something
 * the user has to type. A digit fills the owe slot and the caret jumps past
 * the `|` on its own; owe is one digit in the ordinary case, so that jump
 * happens straight after the first one. The one case that needs a second
 * owe digit — a share of 10 — is reached by pressing Backspace once to step
 * back into the owe slot (without erasing it) and typing the second digit,
 * which itself fills the slot and advances, the same as the first did.
 *
 * `getValue()` still hands back a plain `owe|pay` string, so {@link
 * parseShare} in `split-grid.ts` — which also still reads the old `owe.pay`
 * decimal, for a paste from the original spreadsheet — needs nothing new to
 * receive it.
 *
 * Nothing but a digit reaches the mask: letters, punctuation, the pipe
 * itself, are blocked outright rather than left to flash into the input
 * before the mask redraws over them — a share is a ratio, there is nothing
 * else it could mean.
 *
 * Reuses AG Grid's own input classes (`ag-input-field-input
 * ag-text-field-input`) rather than styling one from scratch, so it inherits
 * the theme's border and focus ring exactly as the editor it replaces did.
 */

import { ChangeDetectionStrategy, Component, computed, ElementRef, signal, viewChild } from '@angular/core';
import { ICellEditorAngularComp } from 'ag-grid-angular';
import { ICellEditorParams } from 'ag-grid-community';

type Slot = 'owe' | 'pay';

@Component({
  selector: 'app-share-cell-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <input
      #input
      class="ag-input-field-input ag-text-field-input"
      type="text"
      inputmode="numeric"
      aria-label="Share, as owe|pay"
      [value]="display()"
      (keydown)="onKeyDown($event)"
      (focus)="placeCaret()"
    />
  `,
  styles: `
    :host {
      display: block;
      width: 100%;
      height: 100%;
    }

    input {
      width: 100%;
      height: 100%;
    }
  `,
})
export class ShareCellEditor implements ICellEditorAngularComp {
  private readonly inputRef = viewChild<ElementRef<HTMLInputElement>>('input');

  private readonly owe = signal('');
  private readonly pay = signal('');
  private readonly slot = signal<Slot>('owe');

  /**
   * True until the first digit lands in a slot that started out already
   * holding a value from an earlier edit — so that digit *replaces* it
   * rather than appending to it, the way typing over a selected value does.
   * Never true for a slot that started this edit empty: appending to
   * nothing and replacing nothing are the same thing.
   */
  private oweReplacesExisting = false;
  private payReplacesExisting = false;

  private params!: ICellEditorParams;

  protected readonly display = computed(() => `${this.owe() || '_'}|${this.pay() || '_'}`);

  agInit(params: ICellEditorParams): void {
    this.params = params;
    if (params.eventKey != null && /^[0-9]$/.test(params.eventKey)) {
      // Typed straight onto the cell: that digit is the share, not a value
      // to replace, so it goes in as the first keystroke of a fresh edit.
      this.owe.set(params.eventKey);
      this.slot.set('pay');
      return;
    }
    const [owe, pay] = splitDisplayed(params.formatValue(params.value));
    this.owe.set(owe);
    this.pay.set(pay);
    this.oweReplacesExisting = owe !== '';
    this.payReplacesExisting = pay !== '';
  }

  getValue(): string {
    return `${this.owe()}|${this.pay()}`;
  }

  afterGuiAttached(): void {
    this.inputRef()?.nativeElement.focus();
    this.placeCaret();
  }

  /**
   * Every keystroke is handled here rather than left to the input's own
   * editing: the mask is redrawn from `owe`/`pay`/`slot`, not typed into
   * directly, which is what lets a digit or two move through it the way a
   * phone number field's own boxes do instead of requiring the `|` itself.
   * Anything not claimed here (Tab, Enter, Escape, a modifier combo) is
   * left for the grid's own navigation — see `onKeyDown` on {@link
   * ICellEditorParams}.
   */
  protected onKeyDown(event: KeyboardEvent): void {
    if (!event.ctrlKey && !event.metaKey && !event.altKey) {
      if (/^[0-9]$/.test(event.key)) {
        event.preventDefault();
        this.typeDigit(event.key);
        return;
      }
      if (event.key === 'Backspace' || event.key === 'Delete') {
        event.preventDefault();
        this.eraseDigit();
        return;
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        this.slot.set(event.key === 'ArrowLeft' ? 'owe' : 'pay');
        this.placeCaret();
        return;
      }
      // Any other single character — a letter, a space, punctuation, the
      // pipe itself — is not part of a share. Blocked outright rather than
      // left to flash into the input before the mask redraws over it.
      if (event.key.length === 1) {
        event.preventDefault();
        return;
      }
    }
    this.params.onKeyDown(event);
  }

  private typeDigit(digit: string): void {
    if (this.slot() === 'owe') {
      if (this.oweReplacesExisting) {
        this.owe.set(digit);
        this.oweReplacesExisting = false;
      } else if (this.owe().length < 2) {
        this.owe.update((o) => o + digit);
      } else {
        return;
      }
      // Owe is one digit in the ordinary case — advancing here is what
      // saves typing the `|`. Reaching two digits (a share of 10, built by
      // backing into this slot below) has nowhere further to go either way.
      this.slot.set('pay');
    } else if (this.payReplacesExisting) {
      this.pay.set(digit);
      this.payReplacesExisting = false;
    } else if (this.pay().length < 1) {
      this.pay.update((p) => p + digit);
    }
    this.placeCaret();
  }

  /**
   * Backspace on an empty pay slot steps back into owe *without* erasing it
   * — that is what turns a share of 10 from unreachable into "press
   * Backspace, then 0": the first digit already advanced past owe, so
   * getting a second one in needs a way back that does not undo the first.
   */
  private eraseDigit(): void {
    if (this.slot() === 'pay') {
      if (this.pay()) {
        this.pay.set('');
      } else {
        this.slot.set('owe');
      }
    } else if (this.owe()) {
      this.owe.update((o) => o.slice(0, -1));
    }
    this.placeCaret();
  }

  /** Parks the caret at the end of whichever slot is active, after the mask redraws. */
  protected placeCaret(): void {
    setTimeout(() => {
      const input = this.inputRef()?.nativeElement;
      if (!input) {
        return;
      }
      const position =
        this.slot() === 'owe'
          ? this.owe().length
          : (this.owe() || '_').length + 1 + this.pay().length;
      input.setSelectionRange(position, position);
    });
  }
}

/** Splits this file's own `owe|pay` / bare-`owe` display format back apart. */
function splitDisplayed(formatted: string): [owe: string, pay: string] {
  if (formatted === '') {
    return ['', ''];
  }
  if (formatted.includes('|')) {
    const [owe, pay] = formatted.split('|');
    return [owe, pay];
  }
  return [formatted, ''];
}
