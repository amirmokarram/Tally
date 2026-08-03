import { ChangeDetectionStrategy, Component, ElementRef, inject, viewChildren } from '@angular/core';

import { TripStore } from '../core/trip-store';
import { MoneyPipe } from '../core/money.pipe';

/**
 * The People sheet.
 *
 * Order matters beyond presentation: it fixes the column order of the split
 * grid and decides who absorbs the odd cent when balances are reconciled.
 */
@Component({
  selector: 'app-people-panel',
  imports: [MoneyPipe],
  templateUrl: './people-panel.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
      max-width: 720px;
    }

    .intro {
      margin: 0 0 18px;
      color: var(--text-muted);
    }

    ul {
      margin: 0;
      padding: 0;
      list-style: none;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      overflow: hidden;
      background: var(--surface);
    }

    li {
      display: grid;
      grid-template-columns: 30px 1fr auto auto;
      align-items: center;
      gap: 10px;
      padding: 8px 12px;
      border-bottom: 1px solid var(--border);

      &:last-child {
        border-bottom: none;
      }

      &:nth-child(odd) {
        background: var(--surface-alt);
      }
    }

    .index {
      color: var(--text-muted);
      font-size: 13px;
      text-align: right;
    }

    .balance {
      font-weight: 600;
      font-size: 14px;
      min-width: 90px;
      text-align: right;
    }

    .row-actions {
      display: flex;
      gap: 2px;
    }

    .empty {
      padding: 28px 16px;
      text-align: center;
      color: var(--text-muted);
    }

    .toolbar {
      display: flex;
      gap: 10px;
      margin-top: 14px;
    }

    /* --- Phones ---------------------------------------------------------
       Four things on one line leaves the name box 92px wide — too narrow to
       read a name back — and the row's buttons at 22px, well under a
       fingertip, with delete sitting 2px from "move down". The row becomes
       two lines: the name gets the width, the balance and the buttons get
       the second line and room to be hit. */
    @media (max-width: 640px) {
      li {
        grid-template-columns: 22px minmax(0, 1fr) auto;
        row-gap: 8px;
        padding: 10px 12px;
      }

      .field {
        grid-column: 2 / -1;
      }

      .balance {
        grid-column: 2;
        min-width: 0;
        text-align: left;
      }

      .row-actions {
        grid-column: 3;
        gap: 4px;
      }

      .row-actions .btn {
        min-width: 40px;
        min-height: 40px;
        justify-content: center;
        font-size: 15px;
      }

      /* Removing a person takes their shares with them; it should not sit
         a hair away from the arrow above it. */
      .row-actions .btn:last-child {
        margin-left: 10px;
      }

      .toolbar .btn {
        flex: 1;
        justify-content: center;
        padding: 11px 13px;
      }
    }
  `,
})
export class PeoplePanel {
  protected readonly store = inject(TripStore);

  private readonly nameInputs = viewChildren<ElementRef<HTMLInputElement>>('nameInput');

  protected balanceOf(personId: string): number | null {
    const balance = this.store.balances().find((b) => b.personId === personId);
    return balance ? balance.balance : null;
  }

  protected addPerson(): void {
    this.store.addPerson('');
    // Focus the new row so a list of names can be typed without touching the mouse.
    queueMicrotask(() => {
      const inputs = this.nameInputs();
      inputs[inputs.length - 1]?.nativeElement.focus();
    });
  }

  protected onNameKey(event: KeyboardEvent, isLast: boolean): void {
    if (event.key === 'Enter' && isLast) {
      this.addPerson();
    }
  }

  protected rename(personId: string, event: Event): void {
    this.store.renamePerson(personId, (event.target as HTMLInputElement).value);
  }
}
