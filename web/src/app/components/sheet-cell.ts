/**
 * The Sheet column's cell — the block heading for a group of item rows.
 *
 * It renders three things, because the Sheet column is present on every kind of
 * row: the sheet's name and captions over its block of items, and the labels
 * for the two pinned rows — balances above, the trip total below.
 */

import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ICellRendererAngularComp } from 'ag-grid-angular';
import { ICellRendererParams } from 'ag-grid-community';

import { TripStore } from '../core/trip-store';
import { LedgerRowData, sheetCaption } from './ledger-model';

/**
 * Passed down through `cellRendererParams`. The grid, not the cell, owns the
 * editor panel — a popup rendered inside a cell would be clipped by the grid's
 * viewport, and AG Grid's own cell editors are unavailable on a spanned column.
 */
export interface SheetCellParams extends ICellRendererParams<LedgerRowData> {
  openEditor(sheetId: string): void;
}

@Component({
  selector: 'app-sheet-cell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @switch (kind()) {
      @case ('balances') {
        <span class="balance-label">Each person pays</span>
      }
      @case ('total') {
        <span class="balance-label">Trip total ({{ baseCurrency() }})</span>
      }
      @default {
        <button class="open" type="button" (click)="openEditor()">
        <span class="name" [class.has-error]="hasError()">{{ name() }}</span>
        @if (caption(); as text) {
          <span class="caption">{{ text }}</span>
        }
        @if (payers(); as text) {
          <span class="caption">Paid by {{ text }}</span>
        }
        <span class="caption hint">Click to edit tax, tip, currency…</span>
        </button>
      }
    }
  `,
  styles: `
    :host {
      display: block;
      line-height: 1.35;
      padding: 6px 0;
    }

    /* The whole block is the target: a spanned cell is tall, and hunting for a
       small link inside it would be worse than the tab this replaced. */
    .open {
      display: block;
      width: 100%;
      border: none;
      background: transparent;
      padding: 0;
      font: inherit;
      text-align: left;
      cursor: pointer;
    }

    .name {
      display: block;
      font-weight: 600;
      color: var(--navy-800);

      &.has-error {
        color: var(--credit);
      }
    }

    .caption {
      display: block;
      font-size: 11px;
      color: var(--text-muted);
    }

    /* Only worth saying while the cell is under the pointer — permanently on
       screen it is noise, and the sheet name is what the eye is here for. */
    .hint {
      opacity: 0;
      transition: opacity 120ms;
    }

    :host(:hover) .hint {
      opacity: 1;
    }

    .balance-label {
      font-size: 13px;
      font-weight: 550;
      color: var(--text-muted);
    }

  `,
})
export class SheetCell implements ICellRendererAngularComp {
  private readonly store = inject(TripStore);

  private readonly data = signal<LedgerRowData | undefined>(undefined);
  private params?: SheetCellParams;

  agInit(params: SheetCellParams): void {
    this.params = params;
    this.data.set(params.data);
  }

  refresh(params: SheetCellParams): boolean {
    this.params = params;
    this.data.set(params.data);
    // Handled in place — returning false would make AG Grid destroy and
    // recreate the component on every recalculation.
    return true;
  }

  protected kind(): string {
    return this.data()?.kind ?? 'item';
  }

  private sheet() {
    const data = this.data();
    if (!data || data.kind === 'balances' || data.kind === 'total') {
      return undefined;
    }
    return this.store.sheets().find((s) => s.id === data.sheetId);
  }

  protected baseCurrency(): string {
    return this.store.baseCurrency();
  }

  protected name(): string {
    return this.sheet()?.name || 'Untitled';
  }

  protected caption(): string {
    const sheet = this.sheet();
    return sheet ? sheetCaption(this.store.split().sheetTotals.get(sheet.id)) : '';
  }

  protected payers(): string {
    const sheet = this.sheet();
    if (!sheet?.paidBy.length) {
      return '';
    }
    const people = this.store.people();
    return sheet.paidBy
      .map((id) => people.find((p) => p.id === id)?.name || 'Unnamed')
      .join(', ');
  }

  protected hasError(): boolean {
    const sheet = this.sheet();
    if (!sheet) {
      return false;
    }
    return (this.store.issuesBySheet().get(sheet.id) ?? []).some(
      (i) => i.severity === 'error',
    );
  }

  protected openEditor(): void {
    const data = this.data();
    if (data && 'sheetId' in data) {
      this.params?.openEditor(data.sheetId);
    }
  }
}
