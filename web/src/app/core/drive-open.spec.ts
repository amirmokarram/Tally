import { buildSampleTrip } from '../data/sample-trips';
import { newSavedSplit } from '../models/library.model';
import { buildExportPayload } from './trip-file';
import { DriveOpenError, DriveOpenDeps, parseDriveLaunch, openFromDrive } from './drive-open';

describe('drive open — launch parsing', () => {
  function locationWith(search: string): Pick<Location, 'search'> {
    return { search };
  }

  it('is a no-op for an ordinary page load', () => {
    expect(parseDriveLaunch(locationWith(''))).toBeNull();
    expect(parseDriveLaunch(locationWith('?foo=bar'))).toBeNull();
  });

  it('reads a single-file launch', () => {
    const state = JSON.stringify({ ids: ['file-1'], action: 'open', userId: '123' });
    expect(parseDriveLaunch(locationWith(`?state=${encodeURIComponent(state)}`))).toEqual({
      ids: ['file-1'],
      resourceKeys: undefined,
    });
  });

  it('reads a multi-file launch with resource keys', () => {
    const state = JSON.stringify({
      ids: ['file-1', 'file-2'],
      action: 'open',
      resourceKeys: { 'file-1': 'key-1' },
    });
    const launch = parseDriveLaunch(locationWith(`?state=${encodeURIComponent(state)}`));
    expect(launch?.ids).toEqual(['file-1', 'file-2']);
    expect(launch?.resourceKeys).toEqual({ 'file-1': 'key-1' });
  });

  it('rejects malformed state', () => {
    expect(parseDriveLaunch(locationWith('?state=not-json'))).toBeNull();
    expect(
      parseDriveLaunch(locationWith(`?state=${encodeURIComponent(JSON.stringify({ ids: [] }))}`)),
    ).toBeNull();
    expect(
      parseDriveLaunch(
        locationWith(`?state=${encodeURIComponent(JSON.stringify({ ids: ['a'], action: 'view' }))}`),
      ),
    ).toBeNull();
  });
});

describe('drive open — fetch and import', () => {
  const split = newSavedSplit(buildSampleTrip('camping'), 'a', '2026-08-01T10:00:00.000Z');

  function depsFor(files: Record<string, string>, token = 'token-abc'): DriveOpenDeps {
    return {
      getAccessToken: async () => token,
      fetchFile: async (id, gotToken) => {
        expect(gotToken).toBe(token);
        const contents = files[id];
        if (contents === undefined) {
          throw new DriveOpenError('That file could not be opened from Drive.');
        }
        return contents;
      },
    };
  }

  it('imports every split from a single Drive file', async () => {
    const result = await openFromDrive(
      { ids: ['file-1'] },
      'client-id',
      depsFor({ 'file-1': buildExportPayload([split]) }),
    );
    expect(result.failedCount).toBe(0);
    expect(result.splits).toEqual([split]);
  });

  it('collects splits across a multi-file launch', async () => {
    const other = newSavedSplit(buildSampleTrip('restaurant'), 'b', '2026-08-02T10:00:00.000Z');
    const result = await openFromDrive(
      { ids: ['file-1', 'file-2'] },
      'client-id',
      depsFor({
        'file-1': buildExportPayload([split]),
        'file-2': buildExportPayload([other]),
      }),
    );
    expect(result.failedCount).toBe(0);
    expect(result.splits).toEqual([split, other]);
  });

  it('counts a file that fails to fetch without losing the rest', async () => {
    const result = await openFromDrive(
      { ids: ['file-1', 'missing'] },
      'client-id',
      depsFor({ 'file-1': buildExportPayload([split]) }),
    );
    expect(result.failedCount).toBe(1);
    expect(result.splits).toEqual([split]);
  });

  it('counts a file that fetches but is not a valid split document', async () => {
    const result = await openFromDrive(
      { ids: ['file-1'] },
      'client-id',
      depsFor({ 'file-1': 'this is not json' }),
    );
    expect(result.failedCount).toBe(1);
    expect(result.splits).toEqual([]);
  });

  it('rejects when access could not be authorized at all', async () => {
    await expectAsync(
      openFromDrive({ ids: ['file-1'] }, 'client-id', {
        getAccessToken: async () => {
          throw new DriveOpenError('Drive access was not granted, so the file could not be opened.');
        },
      }),
    ).toBeRejectedWithError(DriveOpenError, /not granted/);
  });

  it('passes the matching resource key through per file', async () => {
    let seenKey: string | undefined;
    const result = await openFromDrive({ ids: ['file-1'], resourceKeys: { 'file-1': 'rk-1' } }, 'client-id', {
      getAccessToken: async () => 'token-abc',
      fetchFile: async (id, _token, resourceKey) => {
        seenKey = resourceKey;
        return buildExportPayload([split]);
      },
    });
    expect(seenKey).toBe('rk-1');
    expect(result.splits).toEqual([split]);
  });
});
