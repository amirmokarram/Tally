/**
 * Person column headers.
 *
 * People used to have a page of their own; in the merged ledger they *are* the
 * columns, so the header is where they get named, reordered and removed.
 * Adding one is a button above the grid — as a trailing column it cost the
 * width of a person for the whole length of the trip.
 *
 * Turned the same quarter turn as the Sheet cell (`sheet-cell.ts`), and for the
 * same reason: a share is at most four characters, so the column only ever
 * needed to be as wide as a name is tall. The name reads up the header, with
 * `✕` beside it in the same line — the header's height standing in for the
 * block height a spanned Sheet cell has to spare.
 *
 * Reordering itself lives outside the grid, in the toolbar's "Reorder →
 * People" dialog (`person-reorder-dialog.ts`) — every ledger column is fixed
 * (`suppressMovable`, `split-grid.ts`) so a stray header drag cannot reshuffle
 * Item, Amount, or a person's own place among the others.
 */

import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { IHeaderAngularComp } from 'ag-grid-angular';
import { IHeaderParams } from 'ag-grid-community';

import { TripStore } from '../core/trip-store';

export interface PersonHeaderParams extends IHeaderParams {
  personId: string;
}

@Component({
  selector: 'app-person-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="line">
      <input
        class="name"
        type="text"
        placeholder="Name"
        [value]="name()"
        [attr.aria-label]="'Person ' + (position() + 1) + ' name'"
        (input)="rename($event)"
        (keydown.enter)="blur($event)"
      />
      <button
        class="remove"
        type="button"
        title="Remove this person and all their shares"
        (click)="remove()"
      >
        ✕
      </button>
    </div>
  `,
  styles: `
    /* The same quarter turn as \`sheet-cell.ts\` — see the note there for why
       \`sideways-lr\` replaced the older \`vertical-rl\` plus \`rotate(180deg)\`. */
    :host {
      display: flex;
      /* Centres \`.line\` across the column's width — its own content (a name
         a few characters wide plus \`✕\`) is narrower than the 30-pixel column
         it sits in, and left to a block's default start edge it reads flush
         left instead of in the middle of the header. */
      align-items: center;
      /* ...and pins it to the header's bottom edge, right above the rows it
         names, rather than centring it top-to-bottom through whatever the
         header's own height happens to be. */
      justify-content: flex-start;
      writing-mode: sideways-lr;
      width: 100%;
      height: 100%;
      overflow: hidden;
      padding: 4px 2px;
    }

    /* \`.line\`'s own length along the header's height — fixed, not \`100%\`,
       both because a fixed number is what \`justify-content\` above needs
       something shorter than the header to push against, and because
       without an explicit height here the input's \`flex: 1\` has nothing to
       size against and balloons instead, clipped by \`overflow: hidden\`
       rather than actually shrinking. 44 is what the header held before this
       column's own height grew past what the name needs. */
    .line {
      height: calc(100% - 18px);
      display: flex;
      align-items: center;
    }

    .name {
      flex: 1;
      max-inline-size: 100%;
      padding: 2px 1px;
      border: 1px solid transparent;
      border-radius: 4px;
      background: transparent;
      color: inherit;
      font: inherit;
      font-weight: 600;

      &::placeholder {
        color: rgb(255 255 255 / 55%);
      }

      &:hover {
        border-color: rgb(255 255 255 / 35%);
      }

      &:focus {
        outline: none;
        border-color: var(--text-invert);
        background: rgb(255 255 255 / 12%);
      }
    }

    /* Quiet until the header is under the pointer, the same as the Sheet
       cell's own \`⋯\` — a person's name is what the eye comes here for, and
       removing them is not a thing to see happen by accident. */
    .remove {
      flex: none;
      border: none;
      background: transparent;
      color: inherit;
      padding-bottom: 5px;
      font-size: 11px;
      line-height: 1.4;
      cursor: pointer;
      opacity: 0;
      transition: opacity 120ms;
    }

    :host(:hover) .remove {
      opacity: 0.55;
    }

    .remove:hover,
    .remove:focus-visible {
      opacity: 1;
    }
  `,
})
export class PersonHeader implements IHeaderAngularComp {
  private readonly store = inject(TripStore);
  private readonly personId = signal('');

  agInit(params: PersonHeaderParams): void {
    this.personId.set(params.personId);
  }

  refresh(params: PersonHeaderParams): boolean {
    this.personId.set(params.personId);
    return true;
  }

  protected name(): string {
    return this.store.people().find((p) => p.id === this.personId())?.name ?? '';
  }

  protected position(): number {
    return this.store.people().findIndex((p) => p.id === this.personId());
  }

  protected rename(event: Event): void {
    this.store.renamePerson(this.personId(), (event.target as HTMLInputElement).value);
  }

  /**
   * Enter finishes the name — and has to be kept from the grid on the way out.
   *
   * AG Grid listens for keydown on the whole header cell, and blurring the
   * input clears the grid's focused header out from under the event that is
   * still bubbling towards that listener; it reads the header back without
   * checking and throws. Nothing is lost by keeping the key: a header has no
   * Enter behaviour of its own.
   */
  protected blur(event: Event): void {
    event.stopPropagation();
    (event.target as HTMLInputElement).blur();
  }

  protected remove(): void {
    this.store.removePerson(this.personId());
  }
}

/** Passed down through `headerComponentParams` — see {@link AddPersonHeader}. */
export interface AddPersonHeaderParams extends IHeaderParams {
  addPerson(): void;
}

/**
 * The trailing column's header: the button that adds a person.
 *
 * A mirror of `AddSheetHeader`. It used to be a "+ Add person" button in the
 * toolbar, which was itself where it went after a first attempt at exactly
 * this trailing column: at 96 pixels wide, an empty column running the full
 * height of the grid was a real cost for a button used once in a while.
 * Narrowed since, first to the 30 pixels a person's own column needs, then
 * to `ADD_PERSON_COLUMN_WIDTH` (`split-grid.ts`) once the button itself lost
 * its border and background — an icon on its own doesn't need a person's
 * full width, only enough to click.
 */
@Component({
  selector: 'app-add-person-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      title="Add person"
      aria-label="Add person"
      (click)="add()"
    >
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
        <path
          d="M8 3.25v9.5M3.25 8h9.5"
          fill="none"
          stroke="currentColor"
          stroke-width="1.75"
          stroke-linecap="round"
        />
      </svg>
    </button>
  `,
  styles: `
    :host {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 100%;
    }

    /* White, not \`--navy-800\`: the header itself is that navy, so the
       icon needs the header's *text* colour (\`--text-invert\`, the same
       white \`.name\`'s placeholder above is mixed from) to read against it
       at all. Dimmed to 0.5 at rest and full at hover/focus rather than
       hidden-then-shown — the button is the only way to add a person, so it
       should be findable without a hover to reveal it, just quieter than
       the row of names beside it. */
    button {
      display: flex;
      align-items: center;
      justify-content: end;
      width: 26px;
      height: 26px;
      padding: 0;
      border: none;
      border-radius: 6px;
      background: transparent;
      color: var(--text-invert);
      opacity: 0.5;
      cursor: pointer;
      transition: opacity 120ms;

      &:hover,
      &:focus-visible {
        opacity: 1;
      }

      &:focus-visible {
        outline: 2px solid var(--text-invert);
        outline-offset: 1px;
      }
    }
  `,
})
export class AddPersonHeader implements IHeaderAngularComp {
  private params?: AddPersonHeaderParams;

  agInit(params: AddPersonHeaderParams): void {
    this.params = params;
  }

  refresh(params: AddPersonHeaderParams): boolean {
    this.params = params;
    return true;
  }

  protected add(): void {
    this.params?.addPerson();
  }
}
