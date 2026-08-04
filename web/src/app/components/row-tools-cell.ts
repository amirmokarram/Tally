/**
 * The last column of an item row: the two shortcuts that would otherwise be a
 * lot of typing across a wide grid.
 */

import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ICellRendererAngularComp } from 'ag-grid-angular';
import { ICellRendererParams } from 'ag-grid-community';

import { TripStore } from '../core/trip-store';
import { LedgerRowData } from './ledger-model';

@Component({
  selector: 'app-row-tools-cell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (itemId(); as id) {
      <button
        class="btn ghost icon"
        type="button"
        title="Give everyone an equal share"
        (click)="store.splitItemEvenly(id)"
      >
        Everyone
      </button>
      <button
        class="btn ghost icon"
        type="button"
        title="Clear this row"
        (click)="store.clearItemShares(id)"
      >
        ✕
      </button>
    }
  `,
  styles: `
    :host {
      display: flex;
      align-items: center;
      gap: 4px;
      height: 100%;
    }
  `,
})
export class RowToolsCell implements ICellRendererAngularComp {
  protected readonly store = inject(TripStore);

  private readonly data = signal<LedgerRowData | undefined>(undefined);

  agInit(params: ICellRendererParams<LedgerRowData>): void {
    this.data.set(params.data);
  }

  refresh(params: ICellRendererParams<LedgerRowData>): boolean {
    this.data.set(params.data);
    return true;
  }

  /** Null on the add rows and the pinned balance row, which have no shares. */
  protected itemId(): string | null {
    const data = this.data();
    return data?.kind === 'item' ? data.row.item.id : null;
  }
}
