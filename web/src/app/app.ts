import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { TripStore } from './core/trip-store';

interface Tab {
  path: string;
  label: string;
}

@Component({
  selector: 'app-root',
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  protected readonly store = inject(TripStore);

  protected readonly tabs: readonly Tab[] = [
    { path: '/splits', label: 'Splits' },
    { path: '/split', label: 'Split' },
    { path: '/help', label: 'Help' },
  ];

  /** Count of open problems, shown as a badge so it is visible from any tab. */
  protected readonly errorCount = computed(
    () => this.store.issues().filter((i) => i.severity === 'error').length,
  );
}
