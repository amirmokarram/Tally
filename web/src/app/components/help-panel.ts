import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { TripStore } from '../core/trip-store';
import { SampleTripId } from '../data/sample-trips';

/**
 * The user guide, carried over from the original PDF and rewritten for this
 * app. The worked examples load real data, so each explanation can be checked
 * against live numbers.
 */
@Component({
  selector: 'app-help-panel',
  imports: [],
  templateUrl: './help-panel.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
    }

    section {
      margin-bottom: 30px;
    }

    h3 {
      font-size: 17px;
      margin-bottom: 8px;
    }

    h4 {
      font-size: 14px;
      margin: 18px 0 6px;
    }

    p,
    li {
      color: var(--text);
    }

    p {
      margin: 0 0 10px;
    }

    ul,
    ol {
      margin: 0 0 12px;
      padding-left: 22px;
    }

    li {
      margin-bottom: 5px;
    }

    code {
      background: var(--navy-050);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 1px 5px;
      font-size: 13px;
    }

    .samples {
      display: grid;
      gap: 10px;
    }

    .sample {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 12px 14px;
    }

    .sample .text {
      flex: 1;
    }

    .sample .title {
      font-weight: 600;
    }

    .sample .blurb {
      font-size: 13px;
      color: var(--text-muted);
    }

    .callout {
      padding: 12px 14px;
      border-left: 3px solid var(--navy-700);
      background: var(--navy-050);
      border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
      margin-bottom: 12px;
      font-size: 14px;
    }
  `,
})
export class HelpPanel {
  protected readonly store = inject(TripStore);

  protected load(id: SampleTripId): void {
    this.store.loadSample(id);
  }
}
