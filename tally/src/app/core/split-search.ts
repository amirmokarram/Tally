/**
 * Searching the split library.
 *
 * Titles alone make a poor index — plenty of splits keep the default name, and
 * people remember a split by what was in it: "the one with Sarah", "the trip
 * with the plane tickets", "that Peruvian place". So the search covers the
 * title, the people, the expense sheet names and the item names.
 *
 * Matching on content the list does not show would look arbitrary, so every
 * match carries its reasons and the list explains itself.
 */

import { SavedSplit } from '../models/library.model';

export type MatchKind = 'person' | 'sheet' | 'item';

export interface MatchReason {
  kind: MatchKind;
  /** The original text, as it will be shown back to the user. */
  label: string;
}

export interface SplitMatch {
  split: SavedSplit;
  /** Why this split matched, beyond its title. Empty for a title-only match. */
  reasons: MatchReason[];
}

/**
 * Folds away the differences a person typing a query does not think about:
 * case, Latin accents, Arabic/Persian harakat, and the Arabic letters that look
 * identical to their Persian counterparts but carry different code points.
 *
 * Without that last part, a name typed with an Arabic yeh never finds the same
 * name stored with a Persian one.
 */
export function normalizeForSearch(text: string): string {
  return text
    .normalize('NFD')
    // Latin combining marks left behind by the decomposition.
    .replace(/[\u0300-\u036F]/g, '')
    // Arabic/Persian harakat.
    .replace(/[\u064B-\u0652]/g, '')
    // Arabic yeh and kaf to their Persian equivalents.
    .replace(/\u064A/g, '\u06CC')
    .replace(/\u0643/g, '\u06A9')
    // Zero-width non-joiner reads as a word break.
    .replace(/\u200C/g, ' ')
    .toLowerCase()
    .trim();
}

interface Haystack {
  normalized: string;
  reason: MatchReason | null;
}

function haystacksFor(split: SavedSplit): Haystack[] {
  const out: Haystack[] = [
    // A title match needs no explanation — it is already on screen.
    { normalized: normalizeForSearch(split.trip.title), reason: null },
  ];

  for (const person of split.trip.people) {
    if (person.name.trim()) {
      out.push({
        normalized: normalizeForSearch(person.name),
        reason: { kind: 'person', label: person.name.trim() },
      });
    }
  }

  for (const sheet of split.trip.sheets) {
    if (sheet.name.trim()) {
      out.push({
        normalized: normalizeForSearch(sheet.name),
        reason: { kind: 'sheet', label: sheet.name.trim() },
      });
    }
    for (const item of sheet.items) {
      if (item.name.trim()) {
        out.push({
          normalized: normalizeForSearch(item.name),
          reason: { kind: 'item', label: item.name.trim() },
        });
      }
    }
  }

  return out;
}

/**
 * Filters the library, preserving the order it was given in.
 *
 * Several words are combined with AND, and each must be found *within a single
 * field*: "sarah pizza" finds a split where Sarah is a person and pizza is an
 * item, but a term is never matched across a boundary between two unrelated
 * names. A blank query returns everything.
 */
export function searchSplits(splits: readonly SavedSplit[], query: string): SplitMatch[] {
  const terms = normalizeForSearch(query).split(/\s+/).filter(Boolean);

  if (terms.length === 0) {
    return splits.map((split) => ({ split, reasons: [] }));
  }

  const matches: SplitMatch[] = [];

  for (const split of splits) {
    const haystacks = haystacksFor(split);

    const everyTermFound = terms.every((term) =>
      haystacks.some((haystack) => haystack.normalized.includes(term)),
    );
    if (!everyTermFound) {
      continue;
    }

    const reasons: MatchReason[] = [];
    const seen = new Set<string>();
    for (const haystack of haystacks) {
      if (!haystack.reason) {
        continue;
      }
      if (!terms.some((term) => haystack.normalized.includes(term))) {
        continue;
      }
      const key = `${haystack.reason.kind}:${haystack.reason.label.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        reasons.push(haystack.reason);
      }
    }

    matches.push({ split, reasons });
  }

  return matches;
}
