/**
 * Reorders a trip's expense sheets — self-contained like `SettingsPopup`
 * (owns its own fixed backdrop), rather than leaning on the grid to draw one
 * the way `SheetEditor` does, since this dialog lives outside AG Grid and has
 * nothing clipping it.
 *
 * Reordering has two independent paths:
 *
 *  - Drag a row by its handle — `@angular/cdk`'s pointer/touch drag, moving
 *    one sheet via `TripStore.moveSheet`.
 *  - Click a row to select it (a plain background highlight, not a focus
 *    ring — nothing here depends on where keyboard focus happens to be, so
 *    there's nothing to discover by tabbing around first). Clicking more
 *    rows adds them to the selection; clicking a selected row removes just
 *    that one. Up/Down then moves every selected sheet together, via
 *    `TripStore.moveSheets`, as one block that keeps their relative order.
 *
 * The two are kept visually apart on purpose: starting a drag clears any
 * click-selection first, so the dragged row's preview is never shown with
 * the click-selected background.
 */

import { ChangeDetectionStrategy, Component, inject, output, signal } from '@angular/core';
import { CdkDragDrop, DragDropModule } from '@angular/cdk/drag-drop';

import { TripStore } from '../core/trip-store';
import { ExpenseSheet } from '../models/trip.model';

@Component({
  selector: 'app-sheet-reorder-dialog',
  imports: [DragDropModule],
  templateUrl: './sheet-reorder-dialog.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'close()',
    '(document:keydown.arrowup)': 'onArrow(-1, $event)',
    '(document:keydown.arrowdown)': 'onArrow(1, $event)',
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

    .hint {
      font-size: 12px;
      color: var(--text-muted);
      margin: 0 0 12px;
    }

    .list {
      display: flex;
      flex-direction: column;
      gap: 4px;
      max-height: 50vh;
      overflow-y: auto;
    }

    .row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 8px;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--surface);
      font-size: 14px;
      cursor: pointer;

      /* The same tint used for a selected option in currency-picker.ts and
         splits-panel.ts — a plain fill, not a border or outline. */
      &.selected {
        background: var(--navy-100);
      }
    }

    .handle {
      display: flex;
      align-items: center;
      justify-content: center;
      flex: none;
      width: 20px;
      height: 20px;
      color: var(--text-muted);
      cursor: grab;
      touch-action: none;
    }

    .name {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* Always the plain surface, regardless of \`.selected\` — a drag is a
       different action from a click-selection and shouldn't look like one,
       even when dragging the row that happened to be selected. */
    .cdk-drag-preview {
      box-sizing: border-box;
      border-radius: 6px;
      box-shadow: var(--shadow);
      background: var(--surface);
    }

    .cdk-drag-placeholder {
      background: var(--surface);
      opacity: 0.3;
    }

    .cdk-drag-animating {
      transition: transform 200ms cubic-bezier(0, 0, 0.2, 1);
    }

    .list.cdk-drop-list-dragging .row:not(.cdk-drag-placeholder) {
      transition: transform 200ms cubic-bezier(0, 0, 0.2, 1);
    }

    .footer {
      display: flex;
      justify-content: flex-end;
      margin-top: 12px;
      padding-top: 14px;
      border-top: 1px solid var(--border);
    }
  `,
})
export class SheetReorderDialog {
  protected readonly store = inject(TripStore);

  /** The sheets Up/Down currently applies to, picked by clicking their rows. */
  protected readonly selectedIds = signal<ReadonlySet<string>>(new Set());

  readonly closed = output<void>();

  protected close(): void {
    this.closed.emit();
  }

  protected isSelected(sheetId: string): boolean {
    return this.selectedIds().has(sheetId);
  }

  protected toggleSelect(sheetId: string): void {
    const next = new Set(this.selectedIds());
    if (!next.delete(sheetId)) {
      next.add(sheetId);
    }
    this.selectedIds.set(next);
  }

  /** A drag is never shown as a click-selection, even mid-drag. */
  protected onDragStarted(): void {
    this.selectedIds.set(new Set());
  }

  protected drop(event: CdkDragDrop<ExpenseSheet[], ExpenseSheet[], ExpenseSheet>): void {
    const delta = event.currentIndex - event.previousIndex;
    if (delta) {
      this.store.moveSheet(event.item.data.id, delta);
    }
  }

  protected onArrow(delta: number, event: Event): void {
    const ids = this.selectedIds();
    if (ids.size) {
      event.preventDefault();
      this.store.moveSheets(ids, delta);
    }
  }
}
