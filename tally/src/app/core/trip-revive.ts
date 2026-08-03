/**
 * Rebuilding a {@link Trip} from untrusted input.
 *
 * Used by both the storage path and the file-import path: anything crossing
 * into the app from outside goes through here, so there is one place where the
 * rules about damaged data live.
 */

import {
  Charge,
  DEFAULT_CURRENCY,
  ExpenseItem,
  ExpenseSheet,
  Person,
  Share,
  Trip,
  amountCharge,
} from '../models/trip.model';

/**
 * Rebuilds a {@link Trip} from unknown input.
 *
 * Structural problems that would leave the app without a coherent trip — not
 * an object, or people/sheets that are not arrays — return null. Problems
 * confined to one entry drop that entry instead, so a single corrupt item
 * cannot cost the user the rest of their data.
 *
 * Referential problems are deliberately left alone: a `paidBy` naming somebody
 * who no longer exists is surfaced by `validation.ts` as `UNKNOWN_PAYER`, which
 * is more useful than silently deleting it.
 */
export function reviveTrip(input: unknown): Trip | null {
  if (!isRecord(input)) {
    return null;
  }
  if (!Array.isArray(input['people']) || !Array.isArray(input['sheets'])) {
    return null;
  }

  const people: Person[] = [];
  const seenPersonIds = new Set<string>();
  for (const entry of input['people']) {
    if (!isRecord(entry)) {
      continue;
    }
    const id = text(entry['id']);
    if (!id || seenPersonIds.has(id)) {
      continue;
    }
    seenPersonIds.add(id);
    people.push({ id, name: text(entry['name']) });
  }

  const sheets: ExpenseSheet[] = [];
  const seenSheetIds = new Set<string>();
  for (const entry of input['sheets']) {
    const sheet = reviveSheet(entry, seenSheetIds);
    if (sheet) {
      sheets.push(sheet);
    }
  }

  return {
    title: text(input['title'], 'Restored Split'),
    baseCurrency: text(input['baseCurrency'], 'USD') || 'USD',
    people,
    sheets,
    shares: reviveShares(input['shares']),
  };
}

function reviveSheet(input: unknown, seenIds: Set<string>): ExpenseSheet | null {
  if (!isRecord(input)) {
    return null;
  }
  const id = text(input['id']);
  if (!id || seenIds.has(id)) {
    return null;
  }
  seenIds.add(id);

  const items: ExpenseItem[] = [];
  const seenItemIds = new Set<string>();
  if (Array.isArray(input['items'])) {
    for (const entry of input['items']) {
      if (!isRecord(entry)) {
        continue;
      }
      const itemId = text(entry['id']);
      if (!itemId || seenItemIds.has(itemId)) {
        continue;
      }
      seenItemIds.add(itemId);
      items.push({ id: itemId, name: text(entry['name']), amount: finite(entry['amount']) });
    }
  }

  const rate = finite(input['rateOverride']);

  return {
    id,
    name: text(input['name'], 'Expenses'),
    currency: text(input['currency'], DEFAULT_CURRENCY) || DEFAULT_CURRENCY,
    rateOverride: rate !== null && rate > 0 ? rate : null,
    paidBy: Array.isArray(input['paidBy'])
      ? input['paidBy'].map((value) => text(value)).filter(Boolean)
      : [],
    tax: reviveCharge(input['tax']),
    tip: reviveCharge(input['tip']),
    discount: reviveCharge(input['discount']),
    items,
  };
}

function reviveCharge(input: unknown): Charge {
  if (!isRecord(input)) {
    return amountCharge(0);
  }
  const value = finite(input['value']);
  return {
    value: value !== null && value >= 0 ? value : 0,
    isPercent: input['isPercent'] === true,
  };
}

function reviveShares(input: unknown): Trip['shares'] {
  const shares: Trip['shares'] = {};
  if (!isRecord(input)) {
    return shares;
  }

  for (const [itemId, byPerson] of Object.entries(input)) {
    if (!isRecord(byPerson)) {
      continue;
    }
    const row: Record<string, Share> = {};
    for (const [personId, share] of Object.entries(byPerson)) {
      if (!isRecord(share)) {
        continue;
      }
      const owe = finite(share['owe']) ?? 0;
      const pay = finite(share['pay']) ?? 0;
      // Same bounds the split grid enforces on entry.
      if (owe < 0 || owe > 10 || pay < 0 || pay > 10) {
        continue;
      }
      if (owe || pay) {
        row[personId] = { owe, pay };
      }
    }
    if (Object.keys(row).length) {
      shares[itemId] = row;
    }
  }

  return shares;
}

// --- Coercion helpers ---------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
