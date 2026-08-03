/**
 * Exporting splits to a JSON file and reading them back.
 *
 * Files use the same versioned envelope as browser storage, so there is one
 * format to validate and one place to version it. A file is also the only way
 * to move a split between devices or hand it to somebody else — the app has no
 * server — so the format is treated as an interface rather than a dump: it is
 * pretty-printed, it says which app wrote it, and it is read with the same
 * defensive revival as anything else from outside.
 *
 * A file carries *one or many* splits, which is what lets the same code path
 * serve both "send this split to a friend" and "back up everything".
 */

import { SavedSplit } from '../models/library.model';
import { buildDocument, readDocument } from './library-storage';

/** An import that failed for a reason worth showing the user. */
export class TripFileError extends Error {}

/**
 * Refuse anything implausible before reading it into memory. A split with a
 * hundred items is a few tens of kilobytes; ten megabytes is not a library.
 */
const MAX_FILE_BYTES = 10 * 1024 * 1024;

export const EXPORT_MIME_TYPE = 'application/json';

/** Path separators and characters filesystems reject outright. */
const ILLEGAL_IN_FILENAME = /[\\/:*?"<>|]/g;

/** Control codes: legal inside a JS string, not inside a filename. */
const CONTROL_CODES = /[\u0000-\u001F\u007F]/g;

/** The file's contents. Indented because people do open these. */
export function buildExportPayload(splits: readonly SavedSplit[]): string {
  return JSON.stringify(buildDocument(splits), null, 2);
}

/**
 * A filename derived from the split's title, or from the count when a whole
 * library is being exported.
 *
 * Only characters that break filesystems are stripped, so a title in any script
 * survives; a title that reduces to nothing falls back to `split`.
 */
export function exportFileName(splits: readonly SavedSplit[], now = new Date()): string {
  const date = now.toISOString().slice(0, 10);

  if (splits.length !== 1) {
    return `splits-${splits.length}-${date}.json`;
  }

  const slug = splits[0].trip.title
    .trim()
    .replace(ILLEGAL_IN_FILENAME, '')
    .replace(CONTROL_CODES, '')
    .replace(/\s+/g, '-')
    .slice(0, 60)
    // A leading dot hides the file; trailing dots and dashes are just untidy.
    .replace(/^[.\-]+/, '')
    .replace(/[.\-]+$/, '');

  return `${slug || 'split'}-${date}.json`;
}

/** Parses a chosen file, throwing {@link TripFileError} with a readable reason. */
export async function readSplitsFile(file: File): Promise<SavedSplit[]> {
  if (file.size > MAX_FILE_BYTES) {
    throw new TripFileError('That file is too large to be a set of splits.');
  }

  let text: string;
  try {
    text = await file.text();
  } catch {
    throw new TripFileError('That file could not be read.');
  }

  const result = readDocument(text);
  if (!result.ok) {
    throw new TripFileError(result.reason);
  }
  return result.splits;
}

/**
 * Hands a string to the browser as a download.
 *
 * Kept apart from the payload building above so the format stays testable
 * without a DOM.
 */
export function downloadJson(fileName: string, contents: string): void {
  const blob = new Blob([contents], { type: EXPORT_MIME_TYPE });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Some browsers need the URL to outlive the click, so revoke on the next tick
  // rather than immediately.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
