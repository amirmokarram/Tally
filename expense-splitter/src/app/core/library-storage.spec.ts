import { buildSampleTrip } from '../data/sample-trips';
import { SavedSplit, newSavedSplit } from '../models/library.model';
import {
  APP_MARKER,
  LEGACY_STORAGE_KEY,
  SCHEMA_VERSION,
  STORAGE_KEY,
  buildDocument,
  clearLibrary,
  loadLibrary,
  parseDocument,
  readDocument,
  saveLibrary,
} from './library-storage';
import { reviveTrip } from './trip-revive';

/** In-memory `Storage` so the tests never touch the real localStorage. */
export class FakeStorage implements Storage {
  private readonly map = new Map<string, string>();
  /** When set, every write throws — the quota-exceeded case. */
  failWrites = false;

  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    if (this.failWrites) {
      throw new DOMException('quota exceeded', 'QuotaExceededError');
    }
    this.map.set(key, value);
  }
}

function libraryOf(...ids: string[]): SavedSplit[] {
  return ids.map((id, i) =>
    newSavedSplit(buildSampleTrip(i % 2 ? 'camping' : 'restaurant'), id, `2026-08-0${i + 1}T00:00:00.000Z`),
  );
}

describe('library storage', () => {
  let storage: FakeStorage;

  beforeEach(() => {
    storage = new FakeStorage();
  });

  it('round-trips a library of several splits', () => {
    const original = libraryOf('a', 'b', 'c');
    expect(saveLibrary(storage, original)).toBe(true);
    expect(loadLibrary(storage)).toEqual(original);
  });

  it('returns null when nothing is saved', () => {
    expect(loadLibrary(storage)).toBeNull();
  });

  it('survives storage that refuses to be read or written', () => {
    expect(loadLibrary(null)).toBeNull();
    expect(saveLibrary(null, libraryOf('a'))).toBe(false);
    expect(() => clearLibrary(null)).not.toThrow();

    storage.failWrites = true;
    expect(saveLibrary(storage, libraryOf('a'))).toBe(false);
  });

  it('drops a malformed split without losing the rest of the library', () => {
    const good = newSavedSplit(buildSampleTrip('restaurant'), 'good');
    const document = {
      app: APP_MARKER,
      version: SCHEMA_VERSION,
      savedAt: '',
      splits: [
        good,
        null,
        { id: 'no-trip' },
        { trip: buildSampleTrip('camping') }, // no id
        { id: 'good', trip: buildSampleTrip('camping') }, // duplicate id
      ],
    };

    const result = readDocument(JSON.stringify(document));
    expect(result.ok).toBe(true);
    expect(result.ok && result.splits.map((s) => s.id)).toEqual(['good']);
  });

  it('explains why a document could not be read', () => {
    const reason = (raw: string) => {
      const result = readDocument(raw);
      return result.ok ? 'no error' : result.reason;
    };

    expect(reason('not json')).toContain('not valid JSON');
    expect(reason('[1,2,3]')).toContain('does not contain any splits');
    expect(reason(JSON.stringify({ app: 'elsewhere', version: 2 }))).toContain(
      'not exported from this app',
    );
    expect(reason(JSON.stringify({ app: APP_MARKER, version: 99 }))).toContain('version 99');
    expect(reason(JSON.stringify({ app: APP_MARKER, version: 2, splits: [] }))).toContain(
      'does not contain any splits',
    );
  });

  it('fills in timestamps that are missing', () => {
    const raw = JSON.stringify({
      app: APP_MARKER,
      version: SCHEMA_VERSION,
      splits: [{ id: 'x', trip: buildSampleTrip('restaurant') }],
    });
    const [split] = parseDocument(raw)!;
    expect(typeof split.createdAt).toBe('string');
    expect(split.updatedAt).toBe(split.createdAt);
  });
});

describe('library storage — migrating from the single-split format', () => {
  let storage: FakeStorage;

  beforeEach(() => {
    storage = new FakeStorage();
  });

  /** Exactly what the previous build wrote. */
  function writeLegacy(): void {
    storage.setItem(
      LEGACY_STORAGE_KEY,
      JSON.stringify({
        app: APP_MARKER,
        version: 1,
        savedAt: '2026-07-01T12:00:00.000Z',
        trip: buildSampleTrip('new-england'),
      }),
    );
  }

  it('carries a version 1 split into the library rather than discarding it', () => {
    writeLegacy();
    const library = loadLibrary(storage)!;

    expect(library.length).toBe(1);
    expect(library[0].trip.title).toBe('Trip to New England');
    expect(library[0].createdAt).toBe('2026-07-01T12:00:00.000Z');
  });

  it('rewrites it under the new key and clears the old one', () => {
    writeLegacy();
    loadLibrary(storage);

    expect(storage.getItem(LEGACY_STORAGE_KEY)).toBeNull();
    const migrated = parseDocument(storage.getItem(STORAGE_KEY))!;
    expect(migrated[0].trip.title).toBe('Trip to New England');
  });

  it('leaves the old key alone if the migration could not be written', () => {
    writeLegacy();
    storage.failWrites = true;
    const library = loadLibrary(storage)!;

    expect(library.length).toBe(1);
    expect(storage.getItem(LEGACY_STORAGE_KEY)).not.toBeNull();
  });

  it('prefers the library when both keys are present', () => {
    writeLegacy();
    saveLibrary(storage, libraryOf('current'));
    expect(loadLibrary(storage)!.map((s) => s.id)).toEqual(['current']);
  });

  it('accepts a version 1 file on the import path too', () => {
    const raw = JSON.stringify({ version: 1, trip: buildSampleTrip('camping') });
    const result = readDocument(raw);
    expect(result.ok).toBe(true);
    expect(result.ok && result.splits[0].trip.people.length).toBe(6);
  });
});

describe('library storage — document shape', () => {
  it('labels and versions what it writes', () => {
    const doc = buildDocument(libraryOf('a'));
    expect(doc.app).toBe(APP_MARKER);
    expect(doc.version).toBe(SCHEMA_VERSION);
    expect(doc.splits.length).toBe(1);
  });

  it('shares one trip reviver with the import path', () => {
    // Both paths must treat damaged data identically; this is the seam.
    expect(reviveTrip({ people: 'broken', sheets: [] })).toBeNull();
    expect(reviveTrip({ people: [], sheets: [] })).toBeTruthy();
  });
});
