import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import { TripStore } from './core/trip-store';
import {
  TripFileError,
  buildExportPayload,
  downloadJson,
  exportFileName,
  readSplitsFile,
} from './core/trip-file';
import { DriveLaunch, DriveOpenError, openFromDrive, parseDriveLaunch } from './core/drive-open';
import { SavedSplit } from './models/library.model';
import { SplitsPanel } from './components/splits-panel';
import { SplitGrid } from './components/split-grid';
import { HelpPanel } from './components/help-panel';

type TabId = 'splits' | 'split' | 'help';

interface Tab {
  id: TabId;
  label: string;
}

@Component({
  selector: 'app-root',
  imports: [SplitsPanel, SplitGrid, HelpPanel],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  protected readonly store = inject(TripStore);

  protected readonly tabs: readonly Tab[] = [
    { id: 'splits', label: 'Splits' },
    { id: 'split', label: 'Split' },
    { id: 'help', label: 'Help' },
  ];

  /**
   * A returning user with data in progress wants the grid, not the guide;
   * a first-time user wants the opposite.
   */
  protected readonly tab = signal<TabId>(
    this.store.restoredFromStorage && this.store.people().length ? 'split' : 'help',
  );

  /** Count of open problems, shown as a badge so it is visible from any tab. */
  protected readonly errorCount = computed(
    () => this.store.issues().filter((i) => i.severity === 'error').length,
  );

  protected select(tab: TabId): void {
    this.tab.set(tab);
  }

  // --- Opened from Google Drive -------------------------------------------

  /** Shown while a Drive launch is authorizing and fetching, before anything else is visible. */
  protected readonly driveImportPending = signal(false);

  /** Problem opening a file Drive launched the app with, if any. */
  protected readonly driveImportError = signal<string | null>(null);

  constructor() {
    const launch = parseDriveLaunch(window.location);
    if (launch) {
      void this.openDriveLaunch(launch);
    }
  }

  private async openDriveLaunch(launch: DriveLaunch): Promise<void> {
    this.driveImportPending.set(true);
    this.driveImportError.set(null);

    try {
      const { splits, failedCount } = await openFromDrive(launch);

      if (splits.length) {
        const added = this.store.importSplits(splits);
        this.select(added.length === 1 ? 'split' : 'splits');
      }

      if (failedCount > 0) {
        this.driveImportError.set(
          splits.length
            ? `Opened ${splits.length} split${splits.length === 1 ? '' : 's'} from Drive, but ${failedCount} file${failedCount === 1 ? '' : 's'} could not be read.`
            : 'That file could not be opened from Drive.',
        );
      }
    } catch (error) {
      this.driveImportError.set(
        error instanceof DriveOpenError ? error.message : 'That file could not be opened from Drive.',
      );
    } finally {
      this.driveImportPending.set(false);
    }
  }

  protected dismissDriveImportError(): void {
    this.driveImportError.set(null);
  }

  // --- Export / import --------------------------------------------------

  /** Problem with the last file the user tried to import, if any. */
  protected readonly importError = signal<string | null>(null);

  /** Confirmation of the last successful import, so it is clear what arrived. */
  protected readonly importNotice = signal<string | null>(null);

  protected exportSplits(splits: readonly SavedSplit[]): void {
    if (splits.length) {
      downloadJson(exportFileName(splits), buildExportPayload(splits));
    }
  }

  protected exportAll(): void {
    this.exportSplits(this.store.allSplits());
  }

  /**
   * Reads a chosen file into the library.
   *
   * Imported splits are *added*, never merged over what is already saved, so
   * this cannot destroy an existing split — which is why it needs no
   * confirmation prompt.
   */
  protected async importFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // Reset so choosing the same file again still fires a change event.
    input.value = '';
    if (!file) {
      return;
    }

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
    this.select(added.length === 1 ? 'split' : 'splits');
  }

  protected dismissImportError(): void {
    this.importError.set(null);
  }

  protected dismissImportNotice(): void {
    this.importNotice.set(null);
  }
}
