/**
 * Import/export of splits as JSON files.
 *
 * Pulled out of the shell component so the splits list — now a routed view
 * with no parent template to wire outputs through — can trigger a file pick
 * and show the result on its own. The picker itself has no home in any
 * template; it is built and clicked on demand instead.
 */

import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import { TripStore } from './trip-store';
import {
  TripFileError,
  buildExportPayload,
  downloadJson,
  exportFileName,
  readSplitsFile,
} from './trip-file';
import { SavedSplit } from '../models/library.model';

@Injectable({ providedIn: 'root' })
export class ImportExport {
  private readonly store = inject(TripStore);
  private readonly router = inject(Router);

  /** Problem with the last file the user tried to import, if any. */
  readonly importError = signal<string | null>(null);

  /** Confirmation of the last successful import, so it is clear what arrived. */
  readonly importNotice = signal<string | null>(null);

  dismissImportError(): void {
    this.importError.set(null);
  }

  dismissImportNotice(): void {
    this.importNotice.set(null);
  }

  exportSplits(splits: readonly SavedSplit[]): void {
    if (splits.length) {
      downloadJson(exportFileName(splits), buildExportPayload(splits));
    }
  }

  exportAll(): void {
    this.exportSplits(this.store.allSplits());
  }

  /** Opens the browser's file picker and imports whatever the user chooses. */
  triggerImport(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file) {
        void this.importFile(file);
      }
    });
    input.click();
  }

  /**
   * Reads a chosen file into the library.
   *
   * Imported splits are *added*, never merged over what is already saved, so
   * this cannot destroy an existing split — which is why it needs no
   * confirmation prompt. Lands on the Split tab when there is exactly one
   * new split to look at, otherwise on the Splits list.
   */
  private async importFile(file: File): Promise<void> {
    this.importError.set(null);
    this.importNotice.set(null);

    let incoming;
    try {
      incoming = await readSplitsFile(file);
    } catch (error) {
      this.importError.set(
        error instanceof TripFileError ? error.message : 'That file could not be imported.',
      );
      return;
    }

    const added = this.store.importSplits(incoming);
    this.importNotice.set(
      added.length === 1
        ? `Imported "${added[0].trip.title}".`
        : `Imported ${added.length} splits.`,
    );
    void this.router.navigateByUrl(added.length === 1 ? '/split' : '/splits');
  }
}
