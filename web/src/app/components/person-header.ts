/**
 * Person column headers.
 *
 * People used to have a page of their own; in the merged ledger they *are* the
 * columns, so the header is where they get named, reordered and removed.
 * Adding one is a button above the grid — as a trailing column it cost the
 * width of a person for the whole length of the trip.
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
    <input
      class="name"
      type="text"
      placeholder="Name"
      [value]="name()"
      [attr.aria-label]="'Person ' + (position() + 1) + ' name'"
      (input)="rename($event)"
      (keydown.enter)="blur($event)"
    />
    <span class="tools">
      <button
        type="button"
        title="Move left"
        [disabled]="position() === 0"
        (click)="move(-1)"
      >
        ◂
      </button>
      <button type="button" title="Move right" [disabled]="isLast()" (click)="move(1)">
        ▸
      </button>
      <button type="button" title="Remove this person and all their shares" (click)="remove()">
        ✕
      </button>
    </span>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      align-items: stretch;
      gap: 2px;
      width: 100%;
      padding: 4px 0;
    }

    .name {
      width: 100%;
      min-width: 0;
      padding: 2px 4px;
      border: 1px solid transparent;
      border-radius: 4px;
      background: transparent;
      color: inherit;
      font: inherit;
      font-weight: 600;
      text-align: center;

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

    .tools {
      display: flex;
      justify-content: center;
      gap: 1px;
    }

    .tools button {
      border: none;
      background: transparent;
      color: inherit;
      opacity: 0.55;
      padding: 0 3px;
      font-size: 11px;
      line-height: 1.4;
      cursor: pointer;

      &:hover:not(:disabled) {
        opacity: 1;
      }

      &:disabled {
        opacity: 0.2;
        cursor: default;
      }
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

  protected isLast(): boolean {
    return this.position() === this.store.people().length - 1;
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

  protected move(delta: number): void {
    this.store.movePerson(this.personId(), delta);
  }

  protected remove(): void {
    this.store.removePerson(this.personId());
  }
}
