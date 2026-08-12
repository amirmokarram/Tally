/**
 * Reorders a trip's expense sheets — self-contained like `SettingsPopup`
 * (owns its own fixed backdrop), rather than leaning on the grid to draw one
 * the way `SheetEditor` does, since this dialog lives outside AG Grid and has
 * nothing clipping it.
 *
 * Dragging calls straight into `TripStore.moveSheet`, which already does the
 * splice-to-index work for people and items too — this is just the first UI
 * wired up to it. `cdkDrag` also gives keyboard reordering (Space to lift,
 * arrows to move, Space to drop) for free, which is why this is CDK
 * drag-and-drop rather than hand-rolled up/down buttons.
 */

import { ChangeDetectionStrategy, Component, inject, output } from '@angular/core';
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

      &:focus-visible {
        outline: 2px solid var(--text-invert);
        outline-offset: 1px;
      }
    }

    .name {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .cdk-drag-preview {
      box-sizing: border-box;
      border-radius: 6px;
      box-shadow: var(--shadow);
    }

    .cdk-drag-placeholder {
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

  readonly closed = output<void>();

  protected close(): void {
    this.closed.emit();
  }

  protected drop(event: CdkDragDrop<ExpenseSheet[], ExpenseSheet[], ExpenseSheet>): void {
    const delta = event.currentIndex - event.previousIndex;
    if (delta) {
      this.store.moveSheet(event.item.data.id, delta);
    }
  }
}
