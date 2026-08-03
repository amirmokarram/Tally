/**
 * Saving and restoring the split library.
 *
 * One document holds every saved split. That keeps writes atomic, keeps the
 * multi-tab change feed down to a single `storage` key, and keeps the format in
 * one place — at these sizes (a few kilobytes per split) rewriting the whole
 * library on each edit costs less than the bookkeeping that splitting it across
 * keys would need. If a user ever accumulates enough splits for that to bite,
 * the fix is a key per split plus an index, not a debounce.
 *
 * Everything read back is untrusted: it may be from an older build, hand-edited
 * in devtools, or truncated by a crashed write. It is validated and coerced
 * entry by entry, and anything unusable is dropped rather than trusted.
 */

import { InjectionToken } from '@angular/core';

import { Trip } from '../models/trip.model';
import { SavedSplit, nowIso } from '../models/library.model';
import { reviveTrip } from './trip-revive';

export const APP_MARKER = 'tally';

/**
 * The marker written before the app was named Tally.
 *
 * Every file a user has already exported carries it, and a file the app
 * refuses to read back is a file the user has lost — so it stays accepted on
 * import for good, even though nothing writes it any more.
 */
export const PRE_RENAME_APP_MARKER = 'split-expenses';

export const STORAGE_KEY = 'tally.library';

/** Library key from before the rename. Migrated across on first load. */
export const PRE_RENAME_STORAGE_KEY = 'split-expenses.library';

/** Single-split key written by builds before the library existed. */
export const LEGACY_STORAGE_KEY = 'split-expenses.trip';

/** Per-tab pointer at the split being viewed. Two tabs can show different splits. */
export const ACTIVE_SPLIT_KEY = 'tally.active';

/** The same pointer, under the pre-rename name. Read, never written. */
export const PRE_RENAME_ACTIVE_SPLIT_KEY = 'split-expenses.active';

/**
 * Document format version.
 *  1 — a single `trip`, no library.
 *  2 — `splits`, an array of saved splits.
 *
 * Version 1 documents are migrated on read, never discarded: somebody with a
 * saved split must not lose it to an upgrade.
 */
export const SCHEMA_VERSION = 2;

export interface LibraryDocument {
  app: typeof APP_MARKER;
  version: number;
  savedAt: string;
  splits: SavedSplit[];
}

export function buildDocument(splits: readonly SavedSplit[]): LibraryDocument {
  return {
    app: APP_MARKER,
    version: SCHEMA_VERSION,
    savedAt: nowIso(),
    splits: [...splits],
  };
}

/** Canonical string form, used to tell two library states apart. */
export function serializeLibrary(splits: readonly SavedSplit[]): string {
  return JSON.stringify(splits);
}

/** Canonical string form of one split's contents. */
export function serializeTrip(trip: Trip): string {
  return JSON.stringify(trip);
}

// --- Storage tokens -----------------------------------------------------

function probe(factory: () => Storage): Storage | null {
  try {
    const storage = factory();
    const key = `${STORAGE_KEY}.probe`;
    storage.setItem(key, '1');
    storage.removeItem(key);
    return storage;
  } catch {
    return null;
  }
}

/**
 * Where the library is kept. Injected rather than reached for directly so tests
 * can opt out, and feature-detected by probing: some privacy modes expose
 * `localStorage` but throw the moment you write to it.
 */
export const TRIP_STORAGE = new InjectionToken<Storage | null>('TRIP_STORAGE', {
  providedIn: 'root',
  factory: () => probe(() => globalThis.localStorage),
});

/**
 * Where the *active split* pointer is kept. `sessionStorage` is per-tab, which
 * is exactly the scope wanted: two tabs can sit on different splits, and each
 * remembers its own across a reload.
 */
export const SESSION_STORAGE = new InjectionToken<Storage | null>('SESSION_STORAGE', {
  providedIn: 'root',
  factory: () => probe(() => globalThis.sessionStorage),
});

// --- Reading ------------------------------------------------------------

/** Why a document could not be read, in words worth showing a user. */
export type DocumentResult =
  | { ok: true; splits: SavedSplit[] }
  | { ok: false; reason: string };

/**
 * Reads a document, explaining any failure.
 *
 * {@link parseDocument} is the terse form for the storage path, which only
 * needs to know whether it worked. Import needs to tell the user *why*.
 */
export function readDocument(raw: string): DocumentResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'That file is not valid JSON.' };
  }

  if (!isRecord(parsed)) {
    return { ok: false, reason: 'That file does not contain any splits.' };
  }

  // Absent on version 1 documents, which predate the marker; the pre-rename
  // marker is still this app's own file and is read as one.
  if (
    'app' in parsed &&
    parsed['app'] !== APP_MARKER &&
    parsed['app'] !== PRE_RENAME_APP_MARKER
  ) {
    return { ok: false, reason: 'That file was not exported from this app.' };
  }

  const version = parsed['version'];

  if (version === 1) {
    const trip = reviveTrip(parsed['trip']);
    if (!trip) {
      return { ok: false, reason: 'That file contains a split this app cannot read.' };
    }
    const at = typeof parsed['savedAt'] === 'string' ? parsed['savedAt'] : nowIso();
    return { ok: true, splits: [{ id: legacyId(), createdAt: at, updatedAt: at, trip }] };
  }

  if (version !== SCHEMA_VERSION) {
    return {
      ok: false,
      reason:
        typeof version === 'number'
          ? `That file uses format version ${version}, and this app reads version ${SCHEMA_VERSION}.`
          : 'That file does not contain any splits.',
    };
  }

  if (!Array.isArray(parsed['splits'])) {
    return { ok: false, reason: 'That file does not contain any splits.' };
  }

  const splits: SavedSplit[] = [];
  const seen = new Set<string>();
  for (const entry of parsed['splits']) {
    const split = reviveSavedSplit(entry, seen);
    if (split) {
      splits.push(split);
    }
  }

  if (splits.length === 0) {
    return { ok: false, reason: 'That file does not contain any splits this app can read.' };
  }

  return { ok: true, splits };
}

export function parseDocument(raw: string | null): SavedSplit[] | null {
  if (!raw) {
    return null;
  }
  const result = readDocument(raw);
  return result.ok ? result.splits : null;
}

function reviveSavedSplit(input: unknown, seen: Set<string>): SavedSplit | null {
  if (!isRecord(input)) {
    return null;
  }
  const id = typeof input['id'] === 'string' ? input['id'] : '';
  if (!id || seen.has(id)) {
    return null;
  }
  const trip = reviveTrip(input['trip']);
  if (!trip) {
    return null;
  }
  seen.add(id);

  const createdAt = typeof input['createdAt'] === 'string' ? input['createdAt'] : nowIso();
  const updatedAt = typeof input['updatedAt'] === 'string' ? input['updatedAt'] : createdAt;
  return { id, createdAt, updatedAt, trip };
}

/**
 * Loads the library, migrating a document left by an earlier build: one saved
 * under the app's pre-rename key, or a single split from before the library
 * existed at all.
 *
 * Each migration is one-way and tidies up after itself: once the library has
 * been written under the current key, the old one is removed.
 */
export function loadLibrary(storage: Storage | null): SavedSplit[] | null {
  if (!storage) {
    return null;
  }

  try {
    const current = parseDocument(storage.getItem(STORAGE_KEY));
    if (current?.length) {
      return current;
    }

    const renamed = parseDocument(storage.getItem(PRE_RENAME_STORAGE_KEY));
    if (renamed?.length) {
      if (saveLibrary(storage, renamed)) {
        storage.removeItem(PRE_RENAME_STORAGE_KEY);
      }
      return renamed;
    }

    const legacy = parseDocument(storage.getItem(LEGACY_STORAGE_KEY));
    if (legacy?.length) {
      if (saveLibrary(storage, legacy)) {
        storage.removeItem(LEGACY_STORAGE_KEY);
      }
      return legacy;
    }
  } catch {
    return null;
  }

  return null;
}

// --- Writing ------------------------------------------------------------

/** Persists the library. Returns false when storage rejected the write. */
export function saveLibrary(storage: Storage | null, splits: readonly SavedSplit[]): boolean {
  if (!storage) {
    return false;
  }
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(buildDocument(splits)));
    return true;
  } catch {
    // Quota exceeded, or storage revoked mid-session.
    return false;
  }
}

export function clearLibrary(storage: Storage | null): void {
  try {
    storage?.removeItem(STORAGE_KEY);
  } catch {
    // Nothing useful to do; the in-memory library is still correct.
  }
}

let legacyCounter = 0;
function legacyId(): string {
  legacyCounter += 1;
  return `split_migrated_${legacyCounter}_${Math.random().toString(36).slice(2, 8)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
