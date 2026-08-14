import { buildSampleTrip } from '../data/sample-trips';
import { SavedSplit, newSavedSplit } from '../models/library.model';
import { Trip } from '../models/trip.model';
import {
  TripFileError,
  buildExportPayload,
  exportFileName,
  readSplitsFile,
  slugifyTitle,
} from './trip-file';
import { APP_MARKER, SCHEMA_VERSION } from './library-storage';

function fileOf(contents: string, name = 'split.json'): File {
  return new File([contents], name, { type: 'application/json' });
}

function splitOf(trip: Trip, id = 'a'): SavedSplit {
  return newSavedSplit(trip, id, '2026-08-01T10:00:00.000Z');
}

describe('trip file — export', () => {
  it('writes a labelled, versioned document', () => {
    const payload = JSON.parse(buildExportPayload([splitOf(buildSampleTrip('camping'))]));
    expect(payload.app).toBe(APP_MARKER);
    expect(payload.version).toBe(SCHEMA_VERSION);
    expect(typeof payload.savedAt).toBe('string');
    expect(payload.splits.length).toBe(1);
    expect(payload.splits[0].trip.people.length).toBe(6);
  });

  it('carries a whole library in one file', () => {
    const payload = JSON.parse(
      buildExportPayload([
        splitOf(buildSampleTrip('camping'), 'a'),
        splitOf(buildSampleTrip('restaurant'), 'b'),
      ]),
    );
    expect(payload.splits.map((s: SavedSplit) => s.trip.title)).toEqual([
      'Camping',
      'Cheesecake Factory',
    ]);
  });

  it('is pretty-printed, since people do open these files', () => {
    expect(buildExportPayload([splitOf(buildSampleTrip('restaurant'))])).toContain('\n  ');
  });

  describe('file names', () => {
    const on = new Date('2026-08-03T09:30:00Z');
    const named = (title: string) =>
      exportFileName([splitOf({ ...buildSampleTrip('restaurant'), title })], on);

    it('derives the name from the title and the date, keeping the title’s case', () => {
      expect(named('Trip to New England')).toBe('Trip-to-New-England-2026-08-03.json');
    });

    it('keeps titles that are not written in Latin script', () => {
      expect(named('سفر شمال')).toBe('سفر-شمال-2026-08-03.json');
    });

    it('strips characters that break filesystems', () => {
      expect(named('Dinner: Bob/Alice *2?')).toBe('Dinner-BobAlice-2-2026-08-03.json');
      expect(named('../../etc/passwd')).toBe('etcpasswd-2026-08-03.json');
    });

    it('never produces a hidden or empty name', () => {
      expect(named('...')).toBe('split-2026-08-03.json');
      expect(named('   ')).toBe('split-2026-08-03.json');
      expect(named('/////')).toBe('split-2026-08-03.json');
    });

    it('caps a very long title', () => {
      const name = named('x'.repeat(200));
      expect(name.length).toBeLessThan(80);
      expect(name.endsWith('-2026-08-03.json')).toBe(true);
    });

    it('names a multi-split file by its count', () => {
      const many = [
        splitOf(buildSampleTrip('camping'), 'a'),
        splitOf(buildSampleTrip('restaurant'), 'b'),
      ];
      expect(exportFileName(many, on)).toBe('splits-2-2026-08-03.json');
    });
  });

  /**
   * The primitive `exportFileName` above is built on, and reused as-is by
   * the PNG report capture (`report-export.ts`) to name its own file — no
   * date suffix or extension of its own, since those are each caller's own.
   */
  describe('slugifyTitle', () => {
    it('is the bare slug, undated and without an extension', () => {
      expect(slugifyTitle('Trip to New England')).toBe('Trip-to-New-England');
    });

    it('falls back to "split" for a title that reduces to nothing', () => {
      expect(slugifyTitle('   ...   ')).toBe('split');
    });
  });
});

describe('trip file — import', () => {
  it('round-trips a split without changing a single value', async () => {
    const original = [splitOf(buildSampleTrip('new-england'))];
    const restored = await readSplitsFile(fileOf(buildExportPayload(original)));
    expect(restored).toEqual(original);
  });

  it('round-trips a whole library', async () => {
    const original = [
      splitOf(buildSampleTrip('camping'), 'a'),
      splitOf(buildSampleTrip('restaurant'), 'b'),
      splitOf(buildSampleTrip('debt-simplification'), 'c'),
    ];
    const restored = await readSplitsFile(fileOf(buildExportPayload(original)));
    expect(restored).toEqual(original);
  });

  it('round-trips percentages, pinned rates and share decimals', async () => {
    const trip: Trip = buildSampleTrip('camping');
    trip.sheets[0].currency = 'HUF';
    trip.sheets[0].rateOverride = 0.00256;
    trip.sheets[0].tip = { value: 0.125, isPercent: true };

    const [restored] = await readSplitsFile(fileOf(buildExportPayload([splitOf(trip)])));
    expect(restored.trip.sheets[0].rateOverride).toBe(0.00256);
    expect(restored.trip.sheets[0].tip).toEqual({ value: 0.125, isPercent: true });
    // 1.1 in the grid — owes one share, paid one.
    const mosquito = trip.sheets[0].items.find((i) => i.name === 'Mosquito Repellent')!;
    expect(restored.trip.shares[mosquito.id]).toEqual(trip.shares[mosquito.id]);
  });

  async function reasonFor(contents: string): Promise<string> {
    try {
      await readSplitsFile(fileOf(contents));
      return 'no error thrown';
    } catch (error) {
      expect(error).toBeInstanceOf(TripFileError);
      return (error as TripFileError).message;
    }
  }

  it('explains why a file could not be imported', async () => {
    expect(await reasonFor('this is not json')).toContain('not valid JSON');
    expect(await reasonFor('[1,2,3]')).toContain('does not contain any splits');
    expect(await reasonFor(JSON.stringify({ app: 'something-else', version: 2 }))).toContain(
      'not exported from this app',
    );
    expect(
      await reasonFor(JSON.stringify({ app: APP_MARKER, version: 99, splits: [] })),
    ).toContain('version 99');
    expect(
      await reasonFor(JSON.stringify({ app: APP_MARKER, version: SCHEMA_VERSION, splits: 7 })),
    ).toContain('does not contain any splits');
  });

  it('refuses a file far too large to be a library', async () => {
    const huge = new File(['x'], 'huge.json', { type: 'application/json' });
    Object.defineProperty(huge, 'size', { value: 50 * 1024 * 1024 });
    await expectAsync(readSplitsFile(huge)).toBeRejectedWithError(TripFileError, /too large/);
  });

  it('accepts a single-split file written by an earlier build', async () => {
    const legacy = JSON.stringify({
      app: APP_MARKER,
      version: 1,
      savedAt: '2026-07-01T00:00:00.000Z',
      trip: buildSampleTrip('restaurant'),
    });
    const restored = await readSplitsFile(fileOf(legacy));
    expect(restored.length).toBe(1);
    expect(restored[0].trip.people.length).toBe(3);
  });

  it('salvages a file with damage confined to one entry', async () => {
    const trip = buildSampleTrip('restaurant') as unknown as Record<string, unknown>;
    (trip['people'] as unknown[]).push({ name: 'no id, will be dropped' });
    const [restored] = await readSplitsFile(
      fileOf(
        JSON.stringify({
          app: APP_MARKER,
          version: SCHEMA_VERSION,
          splits: [{ id: 'a', trip }],
        }),
      ),
    );
    expect(restored.trip.people.map((p) => p.name)).toEqual(['Jack', 'Chris', 'Rose']);
  });
});
