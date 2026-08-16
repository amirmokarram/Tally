/**
 * Reorders a trip's people — the column order in the grid — the same way
 * {@link SheetReorderDialog} reorders expense sheets: self-contained, owning
 * its own fixed backdrop, since it lives outside AG Grid and has nothing
 * clipping it.
 *
 * Before this, the only way to move a person was dragging their column
 * header across the grid — awkward on a phone, where the header is a thin
 * strip and the drag competes with the grid's own horizontal scroll. This
 * dialog gives the same two reordering paths {@link SheetReorderDialog}
 * already has instead:
 *
 *  - Drag a row by its handle — `@angular/cdk`'s pointer/touch drag, moving
 *    one person via `TripStore.movePerson`.
 *  - Click a row to select it, click more rows to add them, then Up/Down
 *    moves every selected person together via `TripStore.movePeople`, as
 *    one block that keeps their relative order.
 */

import { ChangeDetectionStrategy, Component, inject, output, signal } from '@angular/core';
import { CdkDragDrop, DragDropModule } from '@angular/cdk/drag-drop';

import { TripStore } from '../core/trip-store';
import { Person } from '../models/trip.model';

@Component({
  selector: 'app-person-reorder-dialog',
  imports: [DragDropModule],
  templateUrl: './person-reorder-dialog.html',
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
export class PersonReorderDialog {
  protected readonly store = inject(TripStore);

  /** The people Up/Down currently applies to, picked by clicking their rows. */
  protected readonly selectedIds = signal<ReadonlySet<string>>(new Set());

  readonly closed = output<void>();

  protected close(): void {
    this.closed.emit();
  }

  protected isSelected(personId: string): boolean {
    return this.selectedIds().has(personId);
  }

  protected toggleSelect(personId: string): void {
    const next = new Set(this.selectedIds());
    if (!next.delete(personId)) {
      next.add(personId);
    }
    this.selectedIds.set(next);
  }

  /** A drag is never shown as a click-selection, even mid-drag. */
  protected onDragStarted(): void {
    this.selectedIds.set(new Set());
  }

  protected drop(event: CdkDragDrop<Person[], Person[], Person>): void {
    const delta = event.currentIndex - event.previousIndex;
    if (delta) {
      this.store.movePerson(event.item.data.id, delta);
    }
  }

  protected onArrow(delta: number, event: Event): void {
    const ids = this.selectedIds();
    if (ids.size) {
      event.preventDefault();
      this.store.movePeople(ids, delta);
    }
  }
}
