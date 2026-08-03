/**
 * Debt settlement — the port of the workbook's `GetAssignedTransactionGroups`
 * custom function plus the "who pays whom" list the spreadsheet only described
 * in prose.
 *
 * Sign convention throughout: a **positive** balance means the person still
 * owes money, a **negative** balance means they are owed (shown in
 * parentheses / red on the Split sheet).
 *
 * Baseline settlement is a hub: everyone who owes pays the single largest
 * creditor, who then pays the other creditors — `people - 1` transactions.
 * If the balances happen to break into independent zero-sum subsets, each
 * subset can settle internally and the total drops below that baseline. The
 * spreadsheet signalled this by colouring the name headers per group.
 */

import { round } from './split-engine';

/** Largest group count the Split sheet had conditional-format colours for. */
export const MAX_GROUP_COLORS = 7;

/** Above this many people the exact partition search is replaced by a greedy pass. */
const EXACT_SEARCH_LIMIT = 16;

/** Working precision: thousandths of a unit, matching the workbook's ROUND(x, 3). */
const SCALE = 1000;

/**
 * A part is "balanced" if its members' rounding residuals could account for the
 * whole of its non-zero sum. Each balance is off by less than half a cent, so a
 * part of `k` people tolerates `5` thousandths per member.
 */
const TOLERANCE_PER_MEMBER = 5;

/**
 * Partitions people into the largest possible number of self-settling groups.
 *
 * Returns a `personId -> 1-based group` map. It is **empty** when grouping buys
 * nothing — fewer than three people with a balance, or everyone lands in a
 * single group — which is exactly when the workbook left the headers uncoloured.
 *
 * Balances arrive rounded to three decimals, so a genuinely independent group
 * rarely sums to exactly zero; {@link TOLERANCE_PER_MEMBER} absorbs that. The
 * subsequent ±0.01 correction pass then forces each group to zero exactly, so
 * the transfers within a group always clear.
 */
export function assignTransactionGroups(
  balances: Map<string, number>,
  order: readonly string[],
): Map<string, number> {
  const result = new Map<string, number>();

  // Integer thousandths so subset sums compare without float drift.
  const ids = order.filter((id) => Math.round((balances.get(id) ?? 0) * 100) !== 0);
  const values = ids.map((id) => Math.round((balances.get(id) ?? 0) * SCALE));

  if (ids.length < 3) {
    return result;
  }
  // Only meaningful when the whole set nets out; otherwise the numbers are
  // mid-edit and any grouping would be noise.
  if (!isBalanced(values.reduce((a, b) => a + b, 0), values.length)) {
    return result;
  }

  const parts =
    ids.length <= EXACT_SEARCH_LIMIT ? partitionExact(values) : partitionGreedy(values);

  if (parts.length < 2) {
    return result;
  }

  parts.forEach((part, index) => {
    for (const memberIndex of part) {
      result.set(ids[memberIndex], index + 1);
    }
  });

  return result;
}

function isBalanced(sum: number, size: number): boolean {
  return Math.abs(sum) <= TOLERANCE_PER_MEMBER * size;
}

/**
 * Exhaustive maximum-cardinality partition, memoised over subsets.
 *
 * `best[mask]` is the most parts `mask` can be split into. Every candidate
 * submask is forced to contain the lowest set bit, which visits each partition
 * exactly once (the classic 3^n subset-of-subset enumeration).
 */
function partitionExact(values: number[]): number[][] {
  const n = values.length;
  const full = (1 << n) - 1;

  const sums = new Int32Array(1 << n);
  const sizes = new Int8Array(1 << n);
  const flags = new Int8Array(1 << n); // bit 0: has a debtor, bit 1: has a creditor
  for (let mask = 1; mask <= full; mask++) {
    const low = mask & -mask;
    const index = 31 - Math.clz32(low);
    const rest = mask ^ low;
    sums[mask] = sums[rest] + values[index];
    sizes[mask] = sizes[rest] + 1;
    flags[mask] = flags[rest] | (values[index] > 0 ? 1 : 2);
  }

  const best = new Int32Array(1 << n).fill(-1);
  const choice = new Int32Array(1 << n);
  best[0] = 0;

  for (let mask = 1; mask <= full; mask++) {
    const low = mask & -mask;
    for (let sub = mask; sub > 0; sub = (sub - 1) & mask) {
      if (!(sub & low)) {
        continue;
      }
      // A part must net out and must actually contain both a debtor and a
      // creditor — otherwise a lone near-zero balance would become its own
      // "group" that nobody can settle with.
      if (flags[sub] !== 3 || !isBalanced(sums[sub], sizes[sub])) {
        continue;
      }
      const rest = best[mask ^ sub];
      if (rest >= 0 && rest + 1 > best[mask]) {
        best[mask] = rest + 1;
        choice[mask] = sub;
      }
    }
  }

  if (best[full] <= 0) {
    return [indices(full, n)];
  }

  const parts: number[][] = [];
  for (let mask = full; mask > 0; mask ^= choice[mask]) {
    parts.push(indices(choice[mask], n));
  }
  // Restore list order so group 1 starts with the topmost person.
  parts.sort((a, b) => a[0] - b[0]);
  return parts;
}

/**
 * Fallback beyond {@link EXACT_SEARCH_LIMIT}: repeatedly peel off a balanced
 * subset with a bounded depth-first search. Not guaranteed optimal, but the
 * exact search is exponential and a split this large is far beyond anything
 * the spreadsheet supported.
 */
function partitionGreedy(values: number[]): number[][] {
  const remaining = new Set(values.map((_, i) => i));
  const parts: number[][] = [];
  const budget = { steps: 200_000 };

  while (remaining.size > 0) {
    const pool = [...remaining];
    const seed = pool[0];
    // Largest magnitudes first — they constrain the sum fastest.
    const rest = pool.slice(1).sort((a, b) => Math.abs(values[b]) - Math.abs(values[a]));

    const found = findBalancedSubset(values, rest, values[seed], [seed], budget);
    const part = found ?? pool;
    part.sort((a, b) => a - b);
    parts.push(part);
    for (const index of part) {
      remaining.delete(index);
    }
  }

  parts.sort((a, b) => a[0] - b[0]);
  return parts;
}

function findBalancedSubset(
  values: number[],
  pool: number[],
  runningSum: number,
  picked: number[],
  budget: { steps: number },
): number[] | null {
  const signs = picked.reduce((acc, i) => acc | (values[i] > 0 ? 1 : 2), 0);
  if (picked.length > 1 && signs === 3 && isBalanced(runningSum, picked.length)) {
    return picked;
  }
  if (pool.length === 0 || budget.steps-- <= 0) {
    return null;
  }
  const [head, ...tail] = pool;
  return (
    findBalancedSubset(values, tail, runningSum + values[head], [...picked, head], budget) ??
    findBalancedSubset(values, tail, runningSum, picked, budget)
  );
}

function indices(mask: number, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    if (mask & (1 << i)) {
      out.push(i);
    }
  }
  return out;
}

export interface Transfer {
  fromPersonId: string;
  toPersonId: string;
  amount: number;
  /** 1-based settlement group, or 0 when everyone settles together. */
  group: number;
}

/**
 * Minimal list of payments that clears every balance.
 *
 * Within each group the largest debtor pays the largest creditor as much as
 * possible; one of them is fully settled each round, so a group of `m` people
 * clears in at most `m - 1` transfers.
 */
export function buildTransfers(
  balances: Map<string, number>,
  groups: Map<string, number>,
  order: readonly string[],
): Transfer[] {
  const byGroup = new Map<number, string[]>();
  for (const id of order) {
    if (round(balances.get(id) ?? 0, 2) === 0) {
      continue;
    }
    const group = groups.get(id) ?? 0;
    const bucket = byGroup.get(group);
    if (bucket) {
      bucket.push(id);
    } else {
      byGroup.set(group, [id]);
    }
  }

  const transfers: Transfer[] = [];

  for (const [group, members] of [...byGroup.entries()].sort((a, b) => a[0] - b[0])) {
    // Cents again, so the loop terminates cleanly instead of chasing epsilons.
    const ledger = new Map(
      members.map((id) => [id, Math.round((balances.get(id) ?? 0) * 100)]),
    );

    for (;;) {
      let debtor = '';
      let creditor = '';
      let maxOwed = 0;
      let maxCredit = 0;

      for (const [id, value] of ledger) {
        if (value > maxOwed) {
          maxOwed = value;
          debtor = id;
        }
        if (value < maxCredit) {
          maxCredit = value;
          creditor = id;
        }
      }

      if (!debtor || !creditor) {
        break;
      }

      const amount = Math.min(maxOwed, -maxCredit);
      ledger.set(debtor, maxOwed - amount);
      ledger.set(creditor, maxCredit + amount);
      transfers.push({
        fromPersonId: debtor,
        toPersonId: creditor,
        amount: amount / 100,
        group,
      });
    }
  }

  return transfers;
}
