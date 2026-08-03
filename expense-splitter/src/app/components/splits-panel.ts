import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';

import { TripStore } from '../core/trip-store';
import { MoneyPipe } from '../core/money.pipe';
import { computeSheetTotals, round } from '../core/split-engine';
import { MatchReason, searchSplits } from '../core/split-search';
import {
  SPLIT_SORT_OPTIONS,
  SplitSortOrder,
  readSortOrder,
  sortSplits,
  writeSortOrder,
} from '../core/split-sort';
import { TRIP_STORAGE } from '../core/library-storage';
import { SavedSplit } from '../models/library.model';
import { Trip } from '../models/trip.model';
import { CURRENCIES } from '../data/currencies';

interface SplitRow {
  split: SavedSplit;
  isActive: boolean;
  total: number;
  symbol: string;
  people: number;
  items: number;
  updated: string;
  /** Why this split survived the filter, when it was not the title. */
  reasons: MatchReason[];
  // Sort keys, lifted so the ordering never has to reach into `split`.
  title: string;
  updatedAt: string;
  createdAt: string;
}

/**
 * The library: every saved split, most recently edited first.
 *
 * The spreadsheet's equivalent was a folder in Google Drive with a file per
 * trip. This is that list, with the operations that were file operations there
 * — open, duplicate, delete, and send somebody a copy.
 */
@Component({
  selector: 'app-splits-panel',
  imports: [MoneyPipe],
  templateUrl: './splits-panel.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
      max-width: 900px;
    }

    .intro {
      margin: 0 0 18px;
      color: var(--text-muted);
    }

    .toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-bottom: 14px;
    }

    .search {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 14px;
    }

    .search-box {
      position: relative;
      flex: 1;
      min-width: 200px;
      max-width: 420px;
    }

    .search-box input {
      padding-right: 34px;

      /* The browser's own clear affordance duplicates ours. */
      &::-webkit-search-cancel-button {
        display: none;
      }
    }

    .search-clear {
      position: absolute;
      top: 50%;
      right: 4px;
      transform: translateY(-50%);
      border: none;
      background: transparent;
      color: var(--text-muted);
      font-size: 15px;
      line-height: 1;
      padding: 4px 7px;
      border-radius: var(--radius-sm);

      &:hover {
        background: var(--navy-050);
        color: var(--navy-800);
      }
    }

    .result-count {
      font-size: 13px;
      color: var(--text-muted);
      white-space: nowrap;
    }

    .sort {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-left: auto;
      font-size: 13px;
      color: var(--text-muted);
      white-space: nowrap;
    }

    .sort select {
      width: auto;
      padding: 6px 8px;
    }

    .reasons {
      margin-top: 6px;
      font-size: 12px;
      color: var(--text-muted);
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      align-items: center;
    }

    .reason {
      border: 1px solid var(--border);
      background: var(--surface-alt);
      border-radius: 999px;
      padding: 1px 8px;
    }

    .reason .kind {
      color: var(--text-muted);
      margin-right: 3px;
    }

    ul {
      margin: 0;
      padding: 0;
      list-style: none;
      display: grid;
      gap: 10px;
    }

    li {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: 14px;
      padding: 14px 16px;

      &.active {
        border-color: var(--navy-700);
        box-shadow: inset 3px 0 0 var(--navy-700), var(--shadow);
      }
    }

    .title {
      font-weight: 650;
      font-size: 16px;
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    .badge-current {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 1px 7px;
      border-radius: 999px;
      background: var(--navy-100);
      color: var(--navy-800);
    }

    .meta {
      margin-top: 3px;
      font-size: 13px;
      color: var(--text-muted);
      display: flex;
      flex-wrap: wrap;
      gap: 4px 10px;
    }

    .meta .total {
      font-weight: 600;
      color: var(--text);
      font-variant-numeric: tabular-nums;
    }

    .row-actions {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }

    .empty {
      padding: 28px 16px;
      text-align: center;
      color: var(--text-muted);
    }
  `,
})
export class SplitsPanel {
  protected readonly store = inject(TripStore);

  /** Asked for by the list; the shell owns file dialogs and tab switching. */
  readonly opened = output<string>();
  readonly exportRequested = output<SavedSplit>();
  readonly importRequested = output<void>();
  readonly exportAllRequested = output<void>();

  /** What the user has typed into the search box. */
  protected readonly query = signal('');

  protected readonly sortOptions = SPLIT_SORT_OPTIONS;

  private readonly storage = inject(TRIP_STORAGE);

  protected readonly sortOrder = signal<SplitSortOrder>(readSortOrder(this.storage));

  /** Filter first, then order what survived. */
  protected readonly rows = computed<SplitRow[]>(() => {
    const activeId = this.store.activeSplitId();

    const matched = searchSplits(this.store.splits(), this.query()).map(
      ({ split, reasons }) => ({
        split,
        reasons,
        isActive: split.id === activeId,
        total: tripTotal(split.trip),
        symbol: CURRENCIES.find((c) => c.code === split.trip.baseCurrency)?.symbol ?? '',
        people: split.trip.people.length,
        items: split.trip.sheets.reduce((count, sheet) => count + sheet.items.length, 0),
        updated: relativeTime(split.updatedAt),
        title: split.trip.title,
        updatedAt: split.updatedAt,
        createdAt: split.createdAt,
      }),
    );

    return sortSplits(matched, this.sortOrder());
  });

  protected readonly total = computed(() => this.store.splits().length);

  protected readonly isFiltering = computed(() => this.query().trim() !== '');

  /** The box only earns its space once there is a list worth narrowing. */
  protected readonly showSearch = computed(() => this.total() > 1 || this.isFiltering());

  protected onQuery(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  protected clearQuery(): void {
    this.query.set('');
  }

  protected onSort(event: Event): void {
    const order = (event.target as HTMLSelectElement).value as SplitSortOrder;
    this.sortOrder.set(order);
    writeSortOrder(this.storage, order);
  }

  protected open(id: string): void {
    this.store.openSplit(id);
    this.opened.emit(id);
  }

  protected duplicate(id: string): void {
    const copy = this.store.duplicateSplit(id);
    if (copy) {
      this.opened.emit(copy.id);
    }
  }

  protected remove(row: SplitRow): void {
    const label = row.split.trip.title || 'this split';
    const isEmpty = row.people === 0 && row.items === 0;
    if (!isEmpty && !confirm(`Delete "${label}"? Export it first if you want to keep it.`)) {
      return;
    }
    this.store.deleteSplit(row.split.id);
  }
}

/**
 * A split's grand total, without running the full engine.
 *
 * The library list only needs the headline figure, and balances and settlement
 * groups are far more work than summing what each sheet already knows.
 */
function tripTotal(trip: Trip): number {
  return round(
    trip.sheets.reduce(
      (total, sheet) => total + computeSheetTotals(sheet, trip.baseCurrency).totalInBase,
      0,
    ),
    2,
  );
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) {
    return '';
  }
  const minutes = Math.round((Date.now() - then) / 60_000);
  if (minutes < 1) {
    return 'just now';
  }
  if (minutes < 60) {
    return `${minutes} min ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours} h ago`;
  }
  const days = Math.round(hours / 24);
  if (days < 30) {
    return `${days} d ago`;
  }
  return new Date(iso).toLocaleDateString();
}
