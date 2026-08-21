/**
 * App-wide display preferences — not part of any trip, so they live outside
 * `TripStore`/`library-storage.ts` and under their own key. Keeping them out
 * of the trip document means they never travel along with an export/import.
 *
 * Only one setting exists today (the totals band's height), but the shape is
 * a versioned document, the same discipline `library-storage.ts` uses for the
 * library, so a second setting is an added field, not a rewrite.
 */

import { Injectable, effect, inject, signal } from '@angular/core';

import { TRIP_STORAGE } from './library-storage';

export const SETTINGS_STORAGE_KEY = 'tally.settings';

const SETTINGS_VERSION = 1;

/** The band's shortest and tallest allowed override, in pixels. */
export const TOTALS_BAND_HEIGHT_MIN = 48;
export const TOTALS_BAND_HEIGHT_MAX = 240;

interface SettingsDocument {
  version: number;
  /** `null` means automatic — sized to fit its content. */
  totalsBandHeight: number | null;
  /** Whether hovering a row highlights it. */
  rowHoverEnabled: boolean;
  /** Whether a line's number counts up across the whole trip rather than resetting per sheet. */
  continuousRowNumbers: boolean;
  /** Whether the totals band above the grid is hidden. */
  totalsBandCollapsed: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidHeight(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= TOTALS_BAND_HEIGHT_MIN &&
    value <= TOTALS_BAND_HEIGHT_MAX
  );
}

/** Reads and validates the stored document. Anything malformed reverts to defaults. */
function readSettings(storage: Storage | null): SettingsDocument {
  const fallback: SettingsDocument = {
    version: SETTINGS_VERSION,
    totalsBandHeight: null,
    rowHoverEnabled: true,
    continuousRowNumbers: false,
    totalsBandCollapsed: false,
  };
  if (!storage) {
    return fallback;
  }
  try {
    const raw = storage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) {
      return fallback;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return fallback;
    }
    const height = parsed['totalsBandHeight'];
    const rowHoverEnabled = parsed['rowHoverEnabled'];
    const continuousRowNumbers = parsed['continuousRowNumbers'];
    const totalsBandCollapsed = parsed['totalsBandCollapsed'];
    return {
      version: SETTINGS_VERSION,
      totalsBandHeight: height === null || isValidHeight(height) ? height : null,
      rowHoverEnabled: typeof rowHoverEnabled === 'boolean' ? rowHoverEnabled : true,
      continuousRowNumbers: typeof continuousRowNumbers === 'boolean' ? continuousRowNumbers : false,
      totalsBandCollapsed: typeof totalsBandCollapsed === 'boolean' ? totalsBandCollapsed : false,
    };
  } catch {
    return fallback;
  }
}

function writeSettings(storage: Storage | null, document: SettingsDocument): void {
  try {
    storage?.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(document));
  } catch {
    // Quota exceeded, or storage revoked mid-session — the in-memory value is
    // still correct for the rest of this session.
  }
}

@Injectable({ providedIn: 'root' })
export class ReportSettings {
  private readonly storage = inject(TRIP_STORAGE);

  private readonly initial = readSettings(this.storage);

  private readonly totalsBandHeightState = signal<number | null>(this.initial.totalsBandHeight);

  /** The totals band's height override, in pixels — `null` for automatic. */
  readonly totalsBandHeight = this.totalsBandHeightState.asReadonly();

  private readonly rowHoverEnabledState = signal<boolean>(this.initial.rowHoverEnabled);

  /** Whether hovering a row highlights it. */
  readonly rowHoverEnabled = this.rowHoverEnabledState.asReadonly();

  private readonly continuousRowNumbersState = signal<boolean>(this.initial.continuousRowNumbers);

  /** Whether a line's number counts up across the whole trip rather than resetting per sheet. */
  readonly continuousRowNumbers = this.continuousRowNumbersState.asReadonly();

  private readonly totalsBandCollapsedState = signal<boolean>(this.initial.totalsBandCollapsed);

  /** Whether the totals band above the grid is hidden. */
  readonly totalsBandCollapsed = this.totalsBandCollapsedState.asReadonly();

  constructor() {
    effect(() => {
      writeSettings(this.storage, {
        version: SETTINGS_VERSION,
        totalsBandHeight: this.totalsBandHeightState(),
        rowHoverEnabled: this.rowHoverEnabledState(),
        continuousRowNumbers: this.continuousRowNumbersState(),
        totalsBandCollapsed: this.totalsBandCollapsedState(),
      });
    });
  }

  setTotalsBandHeight(px: number | null): void {
    this.totalsBandHeightState.set(px === null ? null : Math.round(px));
  }

  setRowHoverEnabled(enabled: boolean): void {
    this.rowHoverEnabledState.set(enabled);
  }

  setContinuousRowNumbers(enabled: boolean): void {
    this.continuousRowNumbersState.set(enabled);
  }

  setTotalsBandCollapsed(collapsed: boolean): void {
    this.totalsBandCollapsedState.set(collapsed);
  }
}
