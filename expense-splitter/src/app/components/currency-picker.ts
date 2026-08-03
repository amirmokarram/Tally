import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  input,
  output,
  signal,
  viewChildren,
} from '@angular/core';

import { CURRENCIES } from '../data/currencies';
import { DEFAULT_CURRENCY } from '../models/trip.model';
import { searchCurrencies } from '../core/currency-search';

/** One row of the list: the catalogue entry plus how it is written out. */
export interface PickerOption {
  code: string;
  name: string;
  label: string;
}

/** Distinguishes the ids of two pickers on the same page. */
let nextId = 0;

/**
 * A currency chooser you can type into.
 *
 * A plain `<select>` over ~200 currencies means either scrolling or the
 * browser's one-letter jump, and neither finds "Hungarian Forint" from the
 * word "forint". This is the ARIA combobox pattern instead: the box filters
 * the list as you type, arrows move through it, Enter picks, Escape backs out
 * leaving the current choice alone.
 *
 * The box is never the source of truth — it shows `value` whenever it is
 * closed, so a half-typed query that was never confirmed cannot be mistaken
 * for a selection.
 */
@Component({
  selector: 'app-currency-picker',
  templateUrl: './currency-picker.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
      position: relative;
    }

    .picker-input {
      width: 100%;
      padding: 7px 10px;
      border: 1px solid var(--border-strong);
      border-radius: var(--radius-sm);
      background: var(--surface);
      color: var(--text);
      text-overflow: ellipsis;

      &:focus {
        outline: 2px solid var(--navy-700);
        outline-offset: -1px;
      }

      &::placeholder {
        color: var(--text);
        opacity: 0.6;
      }
    }

    /* The top bar sits on navy, so the box there has to invert. */
    :host(.dark) .picker-input {
      padding: 6px 10px;
      border-color: rgb(255 255 255 / 30%);
      background: rgb(255 255 255 / 10%);
      color: var(--text-invert);
      font-size: 13px;

      &::placeholder {
        color: rgb(255 255 255 / 75%);
        opacity: 1;
      }

      &:focus {
        outline-color: rgb(255 255 255 / 70%);
        background: rgb(255 255 255 / 16%);
      }
    }

    /* Under 16px, iOS zooms the whole page in when the box takes focus. */
    @media (max-width: 640px) {
      .picker-input,
      :host(.dark) .picker-input {
        font-size: 16px;
      }
    }

    .picker-list {
      position: absolute;
      z-index: 50;
      top: calc(100% + 4px);
      left: 0;
      right: 0;
      min-width: 260px;
      max-height: 300px;
      overflow-y: auto;
      margin: 0;
      padding: 4px;
      list-style: none;
      background: var(--surface);
      border: 1px solid var(--border-strong);
      border-radius: var(--radius-sm);
      box-shadow: var(--shadow);
      color: var(--text);
      font-size: 14px;
    }

    .picker-option {
      display: flex;
      align-items: baseline;
      gap: 8px;
      padding: 6px 8px;
      border-radius: 4px;
      cursor: pointer;
      white-space: nowrap;

      &.active {
        background: var(--navy-050);
      }

      &.selected {
        font-weight: 650;
      }

      &.active.selected {
        background: var(--navy-100);
      }
    }

    .picker-option .code {
      flex: none;
      min-width: 42px;
      font-size: 12px;
      letter-spacing: 0.04em;
      color: var(--text-muted);
    }

    .picker-option.selected .code {
      color: var(--navy-700);
    }

    .picker-option .name {
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .picker-empty {
      padding: 8px;
      color: var(--text-muted);
      font-size: 13px;
    }
  `,
})
export class CurrencyPicker {
  /** The code currently held by the model — a catalogue code or `DEFAULT`. */
  readonly value = input.required<string>();

  /** Accessible name for the box, e.g. "Base currency". */
  readonly label = input('Currency');

  /**
   * Text for the extra "use the trip's base currency" entry, e.g.
   * "Default (USD)". Left unset, the list is the catalogue alone.
   */
  readonly defaultLabel = input<string | null>(null);

  /** Emits the chosen code. Nothing is emitted for a query that was abandoned. */
  readonly changed = output<string>();

  protected readonly DEFAULT_CURRENCY = DEFAULT_CURRENCY;

  private readonly id = `currency-picker-${nextId++}`;
  protected readonly listId = `${this.id}-list`;

  protected readonly open = signal(false);
  protected readonly query = signal('');
  protected readonly activeIndex = signal(0);

  private readonly optionEls = viewChildren<ElementRef<HTMLElement>>('optionEl');

  protected readonly options = computed<PickerOption[]>(() => {
    const catalogue = CURRENCIES.map((currency) => ({
      code: currency.code,
      name: currency.name,
      label: `(${currency.code}) ${currency.name}`,
    }));

    const fallback = this.defaultLabel();
    return fallback
      ? [{ code: DEFAULT_CURRENCY, name: fallback, label: fallback }, ...catalogue]
      : catalogue;
  });

  protected readonly matches = computed(() =>
    searchCurrencies(this.options(), this.query()),
  );

  /** What the closed box reads, falling back to a code no longer in the list. */
  protected readonly displayLabel = computed(
    () => this.options().find((option) => option.code === this.value())?.label ?? this.value(),
  );

  constructor() {
    // Keyboard navigation is useless if the highlighted row is off-screen.
    effect(() => {
      if (this.open()) {
        this.optionEls()[this.activeIndex()]?.nativeElement.scrollIntoView({ block: 'nearest' });
      }
    });
  }

  protected optionId(index: number): string {
    return `${this.id}-option-${index}`;
  }

  /**
   * Opens on the current choice with an empty query, so the whole list is
   * there to browse and the first keystroke starts a fresh search rather than
   * editing the label.
   */
  protected openList(): void {
    if (this.open()) {
      return;
    }
    this.query.set('');
    this.activeIndex.set(Math.max(0, this.options().findIndex((o) => o.code === this.value())));
    this.open.set(true);
  }

  protected close(): void {
    this.open.set(false);
    this.query.set('');
  }

  protected onInput(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
    this.activeIndex.set(0);
  }

  protected choose(option: PickerOption): void {
    this.changed.emit(option.code);
    this.close();
  }

  protected onKeydown(event: KeyboardEvent): void {
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault();
        if (!this.open()) {
          this.openList();
          return;
        }
        const step = event.key === 'ArrowDown' ? 1 : -1;
        const last = Math.max(0, this.matches().length - 1);
        this.activeIndex.set(Math.min(Math.max(this.activeIndex() + step, 0), last));
        return;
      }
      case 'Enter': {
        if (!this.open()) {
          return;
        }
        event.preventDefault();
        const option = this.matches()[this.activeIndex()];
        if (option) {
          this.choose(option);
        }
        return;
      }
      case 'Escape': {
        if (!this.open()) {
          return;
        }
        // Swallowed so a surrounding Escape handler does not also fire.
        event.preventDefault();
        event.stopPropagation();
        this.close();
        return;
      }
      case 'Tab':
        this.close();
    }
  }
}
