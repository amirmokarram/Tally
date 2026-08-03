/**
 * The library: the set of splits a user has saved.
 *
 * A {@link Trip} is one split's contents. A {@link SavedSplit} wraps it with the
 * identity and timestamps the library needs to list, order and address it —
 * kept outside `Trip` so the calculation engine never sees them.
 */

import { Trip } from './trip.model';

export interface SavedSplit {
  /** Stable across renames and edits; what the active-split pointer refers to. */
  readonly id: string;
  createdAt: string;
  /** Bumped on every edit. The library list is ordered by this. */
  updatedAt: string;
  trip: Trip;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function newSavedSplit(trip: Trip, id: string, at = nowIso()): SavedSplit {
  return { id, createdAt: at, updatedAt: at, trip };
}

/**
 * The timestamp to stamp on the next edit: now, or a hair later than the
 * newest split already in the library.
 *
 * Wall-clock milliseconds are not fine enough to order edits by. Creating a
 * split and immediately editing another lands both in the same millisecond,
 * and the library's order then depends on the sort's stability rather than on
 * what the user actually did last. Nudging forward keeps `updatedAt` an
 * ordinary timestamp — never more than a few milliseconds ahead — while making
 * it a total order.
 */
export function nextUpdatedAt(splits: readonly SavedSplit[], now = Date.now()): string {
  const newest = splits.reduce(
    (latest, split) => Math.max(latest, Date.parse(split.updatedAt) || 0),
    0,
  );
  return new Date(Math.max(now, newest + 1)).toISOString();
}

/** Most recently edited first — the order the library is shown in. */
export function byMostRecent(a: SavedSplit, b: SavedSplit): number {
  return b.updatedAt.localeCompare(a.updatedAt);
}

/**
 * Orders a library for display: newest first, later additions winning ties.
 *
 * {@link nextUpdatedAt} means locally edited splits never tie. The index
 * tiebreak is for splits arriving from a file or an older build, whose
 * timestamps this app did not assign.
 */
export function mostRecentFirst(splits: readonly SavedSplit[]): SavedSplit[] {
  return splits
    .map((split, index) => ({ split, index }))
    .sort((a, b) => byMostRecent(a.split, b.split) || b.index - a.index)
    .map((entry) => entry.split);
}
