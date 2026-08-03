import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { TripStore } from '../core/trip-store';
import { MoneyPipe } from '../core/money.pipe';
import { Transfer } from '../core/settlement';

interface TransferView extends Transfer {
  fromName: string;
  toName: string;
}

/**
 * Who ends up paying whom.
 *
 * The spreadsheet stopped at the balance row and described settlement in
 * prose ("everyone can pay Rich, and he will pay $2.35 to Chris"). Since the
 * grouping logic already knows which subsets settle independently, the actual
 * list of payments is worth showing.
 */
@Component({
  selector: 'app-settle-panel',
  imports: [MoneyPipe],
  templateUrl: './settle-panel.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
      max-width: 860px;
    }

    .summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 14px;
      margin-bottom: 22px;
    }

    .stat {
      padding: 14px 16px;
    }

    .stat .label {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--text-muted);
    }

    .stat .value {
      font-size: 24px;
      font-weight: 650;
      font-variant-numeric: tabular-nums;
      margin-top: 2px;
    }

    section {
      margin-bottom: 26px;
    }

    section > h3 {
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--text-muted);
      margin-bottom: 10px;
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
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 14px;
      border-bottom: 1px solid var(--border);

      &:last-child {
        border-bottom: none;
      }

      &:nth-child(odd) {
        background: var(--surface-alt);
      }
    }

    .who {
      flex: 1;
      font-weight: 550;
    }

    .amount {
      font-variant-numeric: tabular-nums;
      font-weight: 650;
      min-width: 100px;
      text-align: right;
    }

    .arrow {
      color: var(--text-muted);
    }

    .group-dot {
      display: inline-block;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      flex: none;
    }

    .note {
      margin: 10px 0 0;
      font-size: 13px;
      color: var(--text-muted);
    }

    .blocked {
      padding: 16px;
      border-radius: var(--radius);
      background: var(--credit-bg);
      color: var(--credit);
    }

    .settled {
      padding: 26px 16px;
      text-align: center;
      color: var(--text-muted);
    }

    /* --- Phones ---------------------------------------------------------
       The three summary tiles stack on a narrow screen and cost 286px — the
       balances, which are the reason for the tab, start below the fold. Each
       tile becomes a single line reading label-then-figure, and the whole
       summary fits in half a thumb's scroll. */
    @media (max-width: 640px) {
      .summary {
        grid-template-columns: minmax(0, 1fr);
        gap: 8px;
        margin-bottom: 18px;
      }

      .stat {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 12px;
        padding: 9px 13px;
      }

      .stat .value {
        font-size: 18px;
        margin-top: 0;
      }

      section {
        margin-bottom: 20px;
      }

      li {
        gap: 10px;
        padding: 10px 12px;
      }

      /* A long name is worth more than a column of aligned figures. */
      .amount {
        min-width: 0;
      }
    }
  `,
})
export class SettlePanel {
  protected readonly store = inject(TripStore);

  protected readonly blocked = computed(() =>
    this.store.issues().filter((i) => i.severity === 'error'),
  );

  protected readonly transfers = computed<TransferView[]>(() => {
    const people = new Map(this.store.people().map((p) => [p.id, p.name || 'Unnamed']));
    return this.store.transfers().map((t) => ({
      ...t,
      fromName: people.get(t.fromPersonId) ?? '?',
      toName: people.get(t.toPersonId) ?? '?',
    }));
  });

  /**
   * Transfers needed if everybody simply paid the single largest creditor:
   * one per person with a non-zero balance, minus that creditor.
   */
  protected readonly baselineTransfers = computed(() => {
    const active = this.store.balances().filter((b) => b.balance !== 0).length;
    return Math.max(0, active - 1);
  });

  protected groupColor(group: number): string {
    return group > 0 ? `var(--group-${((group - 1) % 7) + 1})` : 'var(--border-strong)';
  }
}
