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
 * {@link SplitGrid.onCellMouseDown} does per line, one column over. Disabled
 * when there is nothing to tick, rather than left clickable with nothing to
 * do — an empty sheet, or a split with no sheets at all.
 *
 * The three states are drawn by hand (`.mark`, an `::before` on a sibling of
 * the real, invisibly-opacity'd `<input>`) rather than left to the browser's
 * native rendering: a native indeterminate box reads as a barely-there dash
 * at 15px against a dark header band, easy to miss for a state that is meant
 * to be as legible as checked/unchecked.
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
    <label class="box">
      <input
        #box
        type="checkbox"
        [checked]="all()"
        [disabled]="empty()"
        [attr.aria-label]="empty() ? 'No lines to tick' : all() ? 'Untick every line' : 'Tick every line'"
        [title]="empty() ? 'No lines to tick' : all() ? 'Untick every line' : 'Tick every line'"
        (change)="toggle()"
      />
      <span class="mark" aria-hidden="true"></span>
    </label>
  `,
  styles: `
    :host {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 100%;
    }

    .box {
      position: relative;
      display: inline-flex;
      width: 15px;
      height: 15px;
      cursor: pointer;

      /* One source of truth for "disabled" — the input's own attribute,
         not a second class binding that could drift from it. */
      &:has(input:disabled) {
        cursor: default;
      }
    }

    /* Visually hidden, not \`display: none\` — the checkbox itself stays the
       real interactive and accessible element; \`.mark\` only draws what it
       is doing. Native \`:checked\`/\`:indeterminate\` rendering is too subtle
       at this size against the dark header band (and \`:indeterminate\` has
       no fallback for browsers that render it as a plain unchecked box), so
       both states get their own explicit mark instead of relying on it. */
    input {
      position: absolute;
      inset: 0;
      margin: 0;
      opacity: 0;
      cursor: inherit;
    }

    /* The header sits on the same navy band as every other column's — the
       same translucent-white treatment \`person-header.ts\`'s own name box
       uses, for the same low-contrast-on-navy reason. */
    .mark {
      position: absolute;
      inset: 0;
      border-radius: 3px;
      outline: 1px solid rgb(255 255 255 / 55%);
      outline-offset: -1px;
      display: grid;
      place-content: center;
      pointer-events: none;

      &::before {
        content: '';
        width: 9px;
        height: 9px;
        transform: scale(0);
        background: var(--navy-700);
        /* A checkmark. \`:indeterminate\` below swaps this for a dash instead. */
        clip-path: polygon(14% 44%, 0% 63%, 39% 100%, 100% 20%, 82% 4%, 39% 74%);
      }
    }

    input:hover:not(:disabled) + .mark {
      outline-color: var(--text-invert);
    }

    input:focus-visible + .mark {
      outline: 2px solid var(--text-invert);
      outline-offset: 1px;
    }

    input:checked + .mark,
    input:indeterminate + .mark {
      background: var(--text-invert);
      outline-color: var(--text-invert);
    }

    input:checked + .mark::before {
      transform: scale(1);
    }

    /* Indeterminate reads as a dash, not a shrunk checkmark — a partial tick
       is not "nearly all", it is its own state. */
    input:indeterminate + .mark::before {
      transform: scale(1);
      clip-path: none;
      width: 9px;
      height: 2px;
      border-radius: 1px;
    }

    input:disabled + .mark {
      outline-color: rgb(255 255 255 / 25%);
    }
  `,
})
export class IndexHeader implements IHeaderAngularComp {
  private api?: GridApi<LedgerRowData>;

  private readonly box = viewChild<ElementRef<HTMLInputElement>>('box');

  protected readonly all = signal(false);
  protected readonly some = signal(false);
  protected readonly empty = signal(false);

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
    this.empty.set(total === 0);
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
