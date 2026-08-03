import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import { TripStore } from './core/trip-store';
import { MoneyPipe } from './core/money.pipe';
import {
  TripFileError,
  buildExportPayload,
  downloadJson,
  exportFileName,
  readSplitsFile,
} from './core/trip-file';
import { SavedSplit } from './models/library.model';
import { CurrencyPicker } from './components/currency-picker';
import { SplitsPanel } from './components/splits-panel';
import { PeoplePanel } from './components/people-panel';
import { ExpensesPanel } from './components/expenses-panel';
import { SplitGrid } from './components/split-grid';
import { SettlePanel } from './components/settle-panel';
import { HelpPanel } from './components/help-panel';

type TabId = 'splits' | 'people' | 'expenses' | 'split' | 'settle' | 'help';

interface Tab {
  id: TabId;
  label: string;
}

@Component({
  selector: 'app-root',
  imports: [
    MoneyPipe,
    CurrencyPicker,
    SplitsPanel,
    PeoplePanel,
    ExpensesPanel,
    SplitGrid,
    SettlePanel,
    HelpPanel,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  protected readonly store = inject(TripStore);

  protected readonly tabs: readonly Tab[] = [
    { id: 'splits', label: 'Splits' },
    { id: 'people', label: 'People' },
    { id: 'expenses', label: 'Expenses' },
    { id: 'split', label: 'Split' },
    { id: 'settle', label: 'Settle up' },
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

  /**
   * Whether the phone-sized menu is expanded. Wider screens show everything at
   * once, so the flag only ever matters below the breakpoint in `app.scss`.
   */
  protected readonly menuOpen = signal(false);

  protected toggleMenu(): void {
    this.menuOpen.update((open) => !open);
  }

  protected select(tab: TabId): void {
    this.tab.set(tab);
    // Picking a destination is the end of the errand the menu was opened for.
    this.menuOpen.set(false);
  }

  protected onTitle(event: Event): void {
    this.store.setTitle((event.target as HTMLInputElement).value);
  }

  protected newSplit(): void {
    this.store.createSplit();
    this.select('people');
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

  protected exportActive(): void {
    const active = this.store.splitById(this.store.activeSplitId());
    this.exportSplits(active ? [active] : []);
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
