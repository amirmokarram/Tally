/**
 * Ordering the split library.
 *
 * Each order fixes its own sensible direction rather than offering a separate
 * ascending/descending toggle: nobody wants their splits oldest-first or
 * cheapest-first often enough to justify doubling the control surface.
 *
 * Every comparison ends in a tiebreak, so the order is total. The library
 * learned that lesson once already — see `nextUpdatedAt` in
 * `models/library.model.ts` — and a list that reshuffles itself between two
 * identical-looking renders is worse than one sorted badly.
 */

export type SplitSortOrder = 'recent' | 'created' | 'name' | 'total';

export interface SplitSortOption {
  id: SplitSortOrder;
  label: string;
}

export const SPLIT_SORT_OPTIONS: readonly SplitSortOption[] = [
  { id: 'recent', label: 'Recently edited' },
  { id: 'created', label: 'Recently added' },
  { id: 'name', label: 'Name (A–Z)' },
  { id: 'total', label: 'Largest total' },
];

export const DEFAULT_SORT_ORDER: SplitSortOrder = 'recent';

/** The parts of a library row the ordering actually depends on. */
export interface SortableSplit {
  title: string;
  /** Grand total in the split's own base currency. */
  total: number;
  updatedAt: string;
  createdAt: string;
}

/**
 * Locale-aware, and numeric so "Trip 2" comes before "Trip 10".
 *
 * `sensitivity: 'base'` folds case and accents, which keeps the ordering in
 * step with the search — a list that finds "José" under "jose" should not then
 * sort it somewhere unexpected.
 */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function time(iso: string): number {
  return Date.parse(iso) || 0;
}

/**
 * Untitled splits sort last, whichever direction the names run: they are the
 * least identifiable, so they are the least likely to be what is being
 * looked for.
 */
function compareNames(a: SortableSplit, b: SortableSplit): number {
  const left = a.title.trim();
  const right = b.title.trim();
  if (!left && !right) {
    return 0;
  }
  if (!left) {
    return 1;
  }
  if (!right) {
    return -1;
  }
  return collator.compare(left, right);
}

/** Most recently edited first — the fallback whenever a primary key ties. */
function compareRecent(a: SortableSplit, b: SortableSplit): number {
  return time(b.updatedAt) - time(a.updatedAt);
}

export function sortSplits<T extends SortableSplit>(
  rows: readonly T[],
  order: SplitSortOrder,
): T[] {
  const sorted = [...rows];

  switch (order) {
    case 'name':
      sorted.sort((a, b) => compareNames(a, b) || compareRecent(a, b));
      break;

    case 'total':
      sorted.sort(
        (a, b) => b.total - a.total || compareNames(a, b) || compareRecent(a, b),
      );
      break;

    case 'created':
      sorted.sort(
        (a, b) => time(b.createdAt) - time(a.createdAt) || compareRecent(a, b) || compareNames(a, b),
      );
      break;

    case 'recent':
    default:
      sorted.sort((a, b) => compareRecent(a, b) || compareNames(a, b));
      break;
  }

  return sorted;
}

// --- Remembering the choice ---------------------------------------------

export const SORT_ORDER_KEY = 'split-expenses.sort';

/**
 * How the list is ordered is a durable preference rather than a per-tab
 * position, so unlike the active split it lives in `localStorage`. Anything
 * unrecognised falls back to the default rather than throwing.
 */
export function readSortOrder(storage: Storage | null): SplitSortOrder {
  try {
    const stored = storage?.getItem(SORT_ORDER_KEY);
    return SPLIT_SORT_OPTIONS.some((option) => option.id === stored)
      ? (stored as SplitSortOrder)
      : DEFAULT_SORT_ORDER;
  } catch {
    return DEFAULT_SORT_ORDER;
  }
}

export function writeSortOrder(storage: Storage | null, order: SplitSortOrder): void {
  try {
    storage?.setItem(SORT_ORDER_KEY, order);
  } catch {
    // Losing the preference costs the user one dropdown next time.
  }
}
