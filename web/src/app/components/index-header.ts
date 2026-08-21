/**
 * The line number column's header — a three-state checkbox standing in for
 * every line's own tick, the same job the removed selection column's header
 * checkbox used to do (see `select-cell.ts` in history: AG Grid pins that
 * column to the front of the list on every rebuild, which is why ticking
 * moved onto this column's cells instead — this header isn't that column,
 * so a real checkbox is free to sit here without hitting that constraint).
 *
 * Unchecked, checked and indeterminate read whether none, all, or some
 * lines are ticked; a click or Space sets them all to match — the same job
 * {@link SplitGrid.onCellMouseDown} does per line, one column over.
 */

import { ChangeDetectionStrategy, Component, ElementRef, effect, signal, viewChild } from '@angular/core';
import { IHeaderAngularComp } from 'ag-grid-angular';
import { GridApi, IHeaderParams, IRowNode } from 'ag-grid-community';

import { LedgerRowData } from './ledger-model';

/** Every row a tick can apply to — the lines, and nothing else. */
function selectableNodes(api: GridApi<LedgerRowData>): IRowNode<LedgerRowData>[] {
  const nodes: IRowNode<LedgerRowData>[] = [];
  api.forEachNode((node) => {
    if (node.selectable) {
      nodes.push(node);
    }
  });
  return nodes;
}

@Component({
  selector: 'app-index-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <input
      #box
      type="checkbox"
      [checked]="all()"
      [attr.aria-label]="all() ? 'Untick every line' : 'Tick every line'"
      [title]="all() ? 'Untick every line' : 'Tick every line'"
      (change)="toggle()"
    />
  `,
  styles: `
    :host {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 100%;
    }

    /* The header sits on the same navy band as every other column's — the
       browser's default checkbox border reads at low contrast there, so it
       gets the same translucent-white treatment \`person-header.ts\`'s own
       name box uses for the same reason. \`accent-color\` alone covers the
       checked and indeterminate fills. */
    input {
      width: 15px;
      height: 15px;
      margin: 0;
      border-radius: 3px;
      outline: 1px solid rgb(255 255 255 / 55%);
      outline-offset: -1px;
      accent-color: var(--text-invert);
      cursor: pointer;
    }

    input:hover {
      outline-color: var(--text-invert);
    }

    input:focus-visible {
      outline: 2px solid var(--text-invert);
      outline-offset: 1px;
    }
  `,
})
export class IndexHeader implements IHeaderAngularComp {
  private api?: GridApi<LedgerRowData>;

  private readonly box = viewChild<ElementRef<HTMLInputElement>>('box');

  protected readonly all = signal(false);
  protected readonly some = signal(false);

  constructor() {
    // Indeterminate has no HTML attribute, only the DOM property — the
    // template can bind `checked` declaratively but not this.
    effect(() => {
      const input = this.box()?.nativeElement;
      if (input) {
        input.indeterminate = this.some();
      }
    });
  }

  agInit(params: IHeaderParams<LedgerRowData>): void {
    this.api = params.api;
    this.read();
  }

  refresh(params: IHeaderParams<LedgerRowData>): boolean {
    this.api = params.api;
    this.read();
    return true;
  }

  private read(): void {
    const api = this.api;
    if (!api) {
      return;
    }
    const total = selectableNodes(api).length;
    const ticked = api.getSelectedNodes().length;
    this.all.set(total > 0 && ticked === total);
    this.some.set(ticked > 0 && ticked < total);
  }

  /**
   * All or nothing. `selectAll` is not used: it would have to be told to skip
   * the rows that cannot be ticked, and naming the nodes says so outright.
   */
  protected toggle(): void {
    const api = this.api;
    if (!api) {
      return;
    }
    api.setNodesSelected({ nodes: selectableNodes(api), newValue: !this.all() });
  }
}
