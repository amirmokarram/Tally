import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
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
  /** Absent for the synthetic "use the trip default" row. */
  symbol?: string;
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

    /* \`fixed\`, not \`absolute\`: the base-currency picker sits in the totals
       band, which needs \`overflow-x: hidden\` to stay in lockstep with the
       grid's own horizontal scroll — but a box with only one overflow axis
       set forces the other to \`auto\`, so an absolutely-positioned list
       would be clipped by the band's now-clipped vertical axis too, despite
       the masthead cell's own \`overflow: visible\`. Position is worked out
       by hand in the constructor to match. */
    .picker-menu {
      position: fixed;
      z-index: 50;
      min-width: 260px;
      padding: 4px;
      background: var(--surface);
      border: 1px solid var(--border-strong);
      border-radius: var(--radius-sm);
      box-shadow: var(--shadow);
      color: var(--text);
      font-size: 14px;
    }

    /* Compact mode has no readout box of its own to type into, so the search
       box lives inside the popup instead — see \`.picker-trigger\`. */
    .picker-search {
      display: block;
      box-sizing: border-box;
      width: 100%;
      margin-bottom: 4px;
      padding: 6px 8px;
      border: 1px solid var(--border-strong);
      border-radius: var(--radius-sm);
      background: var(--surface);
      color: var(--text);
      font-size: 13px;

      &:focus {
        outline: 2px solid var(--navy-700);
        outline-offset: -1px;
      }
    }

    .picker-list {
      max-height: 280px;
      overflow-y: auto;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    /* The collapsed readout for \`compact\` — a symbol and a code rather than
       the full box, for spots too tight for "(USD) US Dollar". */
    .picker-trigger {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 7px 10px;
      border: 1px solid var(--border-strong);
      border-radius: var(--radius-sm);
      background: var(--surface);
      color: var(--text);
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;

      &:hover {
        background: var(--navy-050);
      }

      &:focus-visible {
        outline: 2px solid var(--navy-700);
        outline-offset: -1px;
      }
    }

    /* The one hint, in plain mode, that this reads as text but opens a menu
       like the others don't — dimmer than the label itself so it registers
       as a cue rather than competing with "$ USD" for attention. */
    .trigger-caret {
      flex: none;
      opacity: 0.6;
    }

    /* The report's toolbar reads as a strip of plain-text actions (see
       .toolbar-link in split-grid.ts), so the compact trigger sheds its
       button chrome there instead of standing out as the one boxed control
       among them. */
    :host(.plain) .picker-trigger {
      padding: 6px 5px;
      border: none;
      background: none;
      color: var(--text-muted);
      font-size: 13px;
      font-weight: 600;

      &:hover {
        background: none;
        color: var(--navy-800);
        text-decoration: underline;
      }
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

  /**
   * Collapses the readout to a symbol and a code — e.g. "$ USD" — behind a
   * button, with the search box moved inside the popup instead of being the
   * box itself. For spots too narrow for the full "(USD) US Dollar" line.
   */
  readonly compact = input(false);

  /** Emits the chosen code. Nothing is emitted for a query that was abandoned. */
  readonly changed = output<string>();

  protected readonly DEFAULT_CURRENCY = DEFAULT_CURRENCY;

  private readonly id = `currency-picker-${nextId++}`;
  protected readonly listId = `${this.id}-list`;

  protected readonly open = signal(false);
  protected readonly query = signal('');
  protected readonly activeIndex = signal(0);

  private readonly optionEls = viewChildren<ElementRef<HTMLElement>>('optionEl');
  private readonly menuEl = viewChild<ElementRef<HTMLElement>>('menuEl');
  private readonly searchEl = viewChild<ElementRef<HTMLInputElement>>('searchEl');
  private readonly hostRef = inject(ElementRef<HTMLElement>);

  /** Screen position for the fixed-position list — see the constructor. */
  protected readonly menuTop = signal(0);
  protected readonly menuLeft = signal(0);
  protected readonly menuWidth = signal(0);

  protected readonly options = computed<PickerOption[]>(() => {
    const catalogue = CURRENCIES.map((currency) => ({
      code: currency.code,
      name: currency.name,
      label: `(${currency.code}) ${currency.name}`,
      symbol: currency.symbol,
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

  /** What the compact trigger reads — the symbol next to its code. */
  protected readonly compactDisplay = computed(() => {
    const option = this.options().find((o) => o.code === this.value());
    if (!option) {
      return this.value();
    }
    return option.symbol ? `${option.symbol} ${option.code}` : option.label;
  });

  constructor() {
    effect(() => {
      if (!this.open()) {
        return;
      }

      // The list is `position: fixed`, so its offsets are relative to the
      // viewport — unless some ancestor's `transform` (the sheet editor's
      // modal panel, say) makes that ancestor the containing block instead.
      // `offsetParent` is how the browser reports which one actually applies.
      const hostRect = this.hostRef.nativeElement.getBoundingClientRect();
      const origin = (
        this.menuEl()?.nativeElement.offsetParent as HTMLElement | null
      )?.getBoundingClientRect();
      this.menuTop.set(hostRect.bottom - (origin?.top ?? 0) + 4);
      this.menuLeft.set(hostRect.left - (origin?.left ?? 0));
      this.menuWidth.set(hostRect.width);

      // Keyboard navigation is useless if the highlighted row is off-screen.
      this.optionEls()[this.activeIndex()]?.nativeElement.scrollIntoView({ block: 'nearest' });

      // Compact mode has no box of its own already holding focus — the
      // button that opened it isn't where typing should land.
      if (this.compact()) {
        this.searchEl()?.nativeElement.focus();
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
