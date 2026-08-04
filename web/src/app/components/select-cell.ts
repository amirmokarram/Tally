/**
 * The tick box that chooses a line, and the one in the header that chooses them
 * all.
 *
 * AG Grid renders these itself, but only in a selection column of its own that
 * it writes to the front of the column list on every rebuild — `lockPosition`
 * aside, `ColumnModel.refreshCols` prepends it, so it cannot be put after Sheet
 * and the line number. Only the *drawing* is ours: which rows are selected is
 * still AG Grid's `RowSelectionModule`, read and written through the node.
 */

import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ICellRendererAngularComp, IHeaderAngularComp } from 'ag-grid-angular';
import { GridApi, ICellRendererParams, IHeaderParams, IRowNode } from 'ag-grid-community';

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

const BOX_STYLES = `
  :host {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
  }

  input {
    width: 15px;
    height: 15px;
    margin: 0;
    accent-color: var(--navy-700);
    cursor: pointer;
  }
`;

@Component({
  selector: 'app-select-cell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Nothing at all on the rows that cannot be ticked: the blank line that ends
  // a block, and the pinned summary strip.
  template: `
    @if (selectable()) {
      <input
        type="checkbox"
        [checked]="ticked()"
        [attr.aria-label]="label()"
        (change)="toggle($event)"
      />
    }
  `,
  styles: BOX_STYLES,
})
export class SelectCell implements ICellRendererAngularComp {
  private node?: IRowNode<LedgerRowData>;

  protected readonly ticked = signal(false);
  protected readonly selectable = signal(false);

  agInit(params: ICellRendererParams<LedgerRowData>): void {
    this.read(params);
  }

  refresh(params: ICellRendererParams<LedgerRowData>): boolean {
    this.read(params);
    return true;
  }

  private read(params: ICellRendererParams<LedgerRowData>): void {
    this.node = params.node;
    // `selectable` carries the grid's own `isRowSelectable` answer, but only
    // for rows that scroll: the pinned strip never goes through it and comes
    // back selectable, so it is ruled out here.
    this.selectable.set(!params.node.rowPinned && !!params.node.selectable);
    this.ticked.set(params.node.isSelected() ?? false);
  }

  protected label(): string {
    const data = this.node?.data;
    const name = data?.kind === 'item' ? data.row.item.name : '';
    return name ? `Tick ${name}` : 'Tick this line';
  }

  protected toggle(event: Event): void {
    this.node?.setSelected((event.target as HTMLInputElement).checked);
  }
}

@Component({
  selector: 'app-select-all-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <input
      type="checkbox"
      [checked]="all()"
      [indeterminate]="some()"
      aria-label="Tick every line"
      title="Tick every line"
      (change)="toggle()"
    />
  `,
  styles: BOX_STYLES,
})
export class SelectAllHeader implements IHeaderAngularComp {
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
