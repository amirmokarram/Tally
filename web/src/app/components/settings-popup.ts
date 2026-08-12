/**
 * App-wide display settings, opened from the header's gear icon rather than
 * from inside a report — these preferences apply to every report, not one
 * trip. Self-contained, unlike `SheetEditor`: that panel leans on its host to
 * draw the backdrop because AG Grid clips anything positioned inside it; this
 * popup has no such constraint, so it owns its own backdrop.
 */

import { ChangeDetectionStrategy, Component, inject, output } from '@angular/core';

import {
  ReportSettings,
  TOTALS_BAND_HEIGHT_MAX,
  TOTALS_BAND_HEIGHT_MIN,
} from '../core/report-settings';
import { DEFAULT_TOTALS_BAND_HEIGHT } from './grid-theme';

@Component({
  selector: 'app-settings-popup',
  templateUrl: './settings-popup.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'close()',
  },
  styles: `
    .backdrop {
      position: fixed;
      inset: 0;
      z-index: 60;
      background: rgb(20 53 95 / 22%);
    }

    .panel {
      position: fixed;
      z-index: 61;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 320px;
      background: var(--surface);
      border: 1px solid var(--border-strong);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      padding: 14px 16px;
    }

    h2 {
      font-size: 15px;
      margin: 0 0 12px;
    }

    .row {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-bottom: 6px;
    }

    .row label {
      font-size: 14px;
      color: var(--text-muted);
    }

    .row-inline {
      flex-direction: row;
      align-items: center;
      justify-content: space-between;
    }

    .height-controls {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .height-controls .field {
      width: 90px;
    }

    .hint {
      font-size: 12px;
      color: var(--text-muted);
      margin: 0 0 16px;
    }

    .footer {
      display: flex;
      justify-content: flex-end;
      margin-top: 4px;
      padding-top: 14px;
      border-top: 1px solid var(--border);
    }
  `,
})
export class SettingsPopup {
  protected readonly settings = inject(ReportSettings);

  protected readonly min = TOTALS_BAND_HEIGHT_MIN;
  protected readonly max = TOTALS_BAND_HEIGHT_MAX;
  protected readonly defaultHeight = DEFAULT_TOTALS_BAND_HEIGHT;

  readonly closed = output<void>();

  protected close(): void {
    this.closed.emit();
  }

  protected onHeightInput(event: Event): void {
    const raw = (event.target as HTMLInputElement).value.trim();
    if (raw === '') {
      this.settings.setTotalsBandHeight(null);
      return;
    }
    const value = Number(raw);
    if (Number.isFinite(value)) {
      this.settings.setTotalsBandHeight(Math.min(this.max, Math.max(this.min, value)));
    }
  }

  protected resetHeight(): void {
    this.settings.setTotalsBandHeight(null);
  }

  protected onRowHoverInput(event: Event): void {
    this.settings.setRowHoverEnabled((event.target as HTMLInputElement).checked);
  }

  protected onContinuousRowNumbersInput(event: Event): void {
    this.settings.setContinuousRowNumbers((event.target as HTMLInputElement).checked);
  }
}
