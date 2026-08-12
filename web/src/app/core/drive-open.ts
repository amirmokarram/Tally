/**
 * Opening a `.split` file shared via Google Drive's own "Open with" menu.
 *
 * Drive launches the app by redirecting to the "Open URL" configured in the
 * Drive UI Integration (see the plan under `docs/` — Cloud Console project,
 * OAuth consent screen, `drive.file` scope) with the chosen file id(s) in a
 * `state` query parameter. From there this is the same problem as the
 * existing file import: fetch some text, hand it to {@link readDocument},
 * and add whatever comes back to the library. Auth and fetching are the only
 * parts unique to Drive — validation is reused from `library-storage.ts`
 * unchanged, so a `.split` file opened from Drive and one dragged in by hand
 * are held to exactly the same standard.
 */

import { SavedSplit } from '../models/library.model';
import { readDocument } from './library-storage';

/** A Drive file that could not be opened, for a reason worth showing the user. */
export class DriveOpenError extends Error {}

export interface DriveLaunch {
  readonly ids: readonly string[];
  /** Keyed by file id. Required for files shared with a resource key. */
  readonly resourceKeys?: Readonly<Record<string, string>>;
}

export interface DriveOpenResult {
  splits: SavedSplit[];
  /** Files that were fetched but could not be read as splits, or not fetched at all. */
  failedCount: number;
}

/**
 * OAuth 2.0 Web client ID from the Drive UI Integration's Cloud Console
 * project. Public by design — an SPA client ID is not a secret — but empty
 * until that project exists (see the plan's Phase 0).
 */
export const DRIVE_OAUTH_CLIENT_ID = '764522543883-ok79mribtri5o0k4s82psesuv5h99u5e.apps.googleusercontent.com';

/**
 * Narrowest scope that lets the app read a file the user opened it *with*,
 * without asking for standing access to the rest of their Drive.
 */
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

const GIS_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';

/**
 * Reads Drive's launch query parameters.
 *
 * Returns `null` for an ordinary page load — including a launch link that is
 * malformed, since there is nothing useful to recover from that — so every
 * existing entry point into the app is unaffected.
 */
export function parseDriveLaunch(location: Pick<Location, 'search'>): DriveLaunch | null {
  const state = new URLSearchParams(location.search).get('state');
  if (!state) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(state);
  } catch {
    return null;
  }

  if (!isRecord(parsed) || parsed['action'] !== 'open') {
    return null;
  }

  const ids = parsed['ids'];
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === 'string')) {
    return null;
  }

  const resourceKeys = isRecord(parsed['resourceKeys'])
    ? Object.fromEntries(
        Object.entries(parsed['resourceKeys']).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      )
    : undefined;

  return { ids, resourceKeys };
}

/** Dependencies swapped out in tests so nothing here touches the DOM or the network. */
export interface DriveOpenDeps {
  fetchFile?: (id: string, token: string, resourceKey?: string) => Promise<string>;
  getAccessToken?: (clientId: string) => Promise<string>;
}

/**
 * Authorizes, fetches every file in the launch, and parses each with the
 * same validation the manual import path uses.
 *
 * One bad file in a multi-select should not sink the others, so a fetch or
 * parse failure is counted rather than thrown — only a failure to get an
 * access token at all (denied consent, Drive unreachable) is fatal, since
 * without a token nothing can be read regardless.
 */
export async function openFromDrive(
  launch: DriveLaunch,
  clientId: string = DRIVE_OAUTH_CLIENT_ID,
  deps: DriveOpenDeps = {},
): Promise<DriveOpenResult> {
  const fetchFile = deps.fetchFile ?? fetchDriveFile;
  const getAccessToken = deps.getAccessToken ?? getDriveAccessToken;

  const token = await getAccessToken(clientId);

  const splits: SavedSplit[] = [];
  let failedCount = 0;

  for (const id of launch.ids) {
    try {
      const text = await fetchFile(id, token, launch.resourceKeys?.[id]);
      const result = readDocument(text);
      if (result.ok) {
        splits.push(...result.splits);
      } else {
        failedCount += 1;
      }
    } catch {
      failedCount += 1;
    }
  }

  return { splits, failedCount };
}

// --- Drive API ------------------------------------------------------------

async function fetchDriveFile(id: string, token: string, resourceKey?: string): Promise<string> {
  const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}`);
  url.searchParams.set('alt', 'media');

  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (resourceKey) {
    headers['X-Goog-Drive-Resource-Keys'] = `${id}/${resourceKey}`;
  }

  let response: Response;
  try {
    response = await fetch(url, { headers });
  } catch {
    throw new DriveOpenError('That file could not be opened from Drive. Check your connection and try again.');
  }

  if (!response.ok) {
    throw new DriveOpenError('That file could not be opened from Drive.');
  }

  return response.text();
}

// --- Auth -------------------------------------------------------------------

interface GisTokenResponse {
  access_token?: string;
  error?: string;
}

interface GisTokenClient {
  requestAccessToken(): void;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(config: {
            client_id: string;
            scope: string;
            callback: (response: GisTokenResponse) => void;
          }): GisTokenClient;
        };
      };
    };
  }
}

let gisScriptPromise: Promise<void> | null = null;

/** Loaded on demand, only once a Drive launch is actually detected. */
function loadGoogleIdentityScript(): Promise<void> {
  if (window.google?.accounts?.oauth2) {
    return Promise.resolve();
  }
  if (!gisScriptPromise) {
    gisScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = GIS_SCRIPT_SRC;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        gisScriptPromise = null;
        reject(new DriveOpenError('Could not reach Google to open this file.'));
      };
      document.head.appendChild(script);
    });
  }
  return gisScriptPromise;
}

async function getDriveAccessToken(clientId: string): Promise<string> {
  await loadGoogleIdentityScript();

  return new Promise<string>((resolve, reject) => {
    if (!window.google) {
      reject(new DriveOpenError('Could not reach Google to open this file.'));
      return;
    }
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      callback: (response) => {
        if (response.error || !response.access_token) {
          reject(new DriveOpenError('Drive access was not granted, so the file could not be opened.'));
          return;
        }
        resolve(response.access_token);
      },
    });
    client.requestAccessToken();
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
