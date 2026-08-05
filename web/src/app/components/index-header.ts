/**
 * The line number column's header — "#" doubling as the select-all control
 * the checkbox column's own header used to be.
 *
 * There is no tick box drawn here: the header just reads whether every line
 * is ticked, some are, or none are, and a click sets them all to match — the
 * same job {@link SplitGrid.onCellMouseDown} does per line, one column over.
 */

import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
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
    <button
      type="button"
      [class.all]="all()"
      [class.some]="some()"
      [attr.aria-label]="all() ? 'Untick every line' : 'Tick every line'"
      [title]="all() ? 'Untick every line' : 'Tick every line'"
      (click)="toggle()"
    >
      #
    </button>
  `,
  styles: `
    :host {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      width: 100%;
      height: 100%;
    }

    button {
      all: unset;
      box-sizing: border-box;
      cursor: pointer;
      color: inherit;
      font: inherit;
      font-weight: inherit;
      padding: 2px 6px;
      border: 1px solid transparent;
      border-radius: 4px;
    }

    /* The header sits on the same navy band as every other column's, so a
       hover reads the way \`person-header.ts\`'s own name box does there — a
       translucent white edge rather than a colour that would only work on a
       light background. */
    button:hover {
      border-color: rgb(255 255 255 / 35%);
    }

    button:focus-visible {
      outline: none;
      border-color: var(--text-invert);
    }

    /* Some ticked: a dotted underline rather than a fill, since a partial
       state reads oddly as solid colour on one character. */
    button.some {
      text-decoration: underline dotted;
      text-underline-offset: 3px;
    }

    /* Every line ticked: inverted, the one state worth a fill against the
       dark header band. */
    button.all {
      background: rgb(255 255 255 / 92%);
      color: var(--navy-700);
    }
  `,
})
export class IndexHeader implements IHeaderAngularComp {
  private api?: GridApi<LedgerRowData>;

  protected readonly all = signal(false);
  protected readonly some = signal(false);

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
