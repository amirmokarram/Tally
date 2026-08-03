/**
 * Searching the currency catalogue.
 *
 * The catalogue runs to nearly 200 entries, so scrolling to one is a chore.
 * People arrive knowing either the code ("huf") or the name ("forint"), and
 * usually only part of it, so both have to work.
 *
 * Order matters as much as matching: typing "eur" means the Euro, even though
 * a dozen names contain those letters, so a code match is always ranked above
 * a name match.
 */

import { normalizeForSearch } from './split-search';

/** The shape the search needs — the picker adds display fields of its own. */
export interface CurrencyOption {
  readonly code: string;
  readonly name: string;
}

/** Lower sorts first. */
function rankOf(code: string, name: string, query: string): number {
  if (code === query) {
    return 0;
  }
  if (code.startsWith(query)) {
    return 1;
  }
  if (name.startsWith(query)) {
    return 2;
  }
  // A later word of the name: "rupee" should still find the Indian Rupee.
  if (name.includes(` ${query}`)) {
    return 3;
  }
  return 4;
}

/**
 * Filters and ranks the catalogue.
 *
 * Several words are combined with AND over the code and name together, so
 * "us dollar" finds the US Dollar and "dollar can" finds the Canadian one.
 * A blank query returns everything in catalogue order.
 */
export function searchCurrencies<T extends CurrencyOption>(
  options: readonly T[],
  query: string,
): T[] {
  const normalized = normalizeForSearch(query);
  if (!normalized) {
    return [...options];
  }

  const terms = normalized.split(/\s+/).filter(Boolean);
  const scored: { option: T; rank: number; index: number }[] = [];

  options.forEach((option, index) => {
    const code = normalizeForSearch(option.code);
    const name = normalizeForSearch(option.name);
    const haystack = `${code} ${name}`;
    if (!terms.every((term) => haystack.includes(term))) {
      return;
    }
    scored.push({ option, rank: rankOf(code, name, normalized), index });
  });

  // The index tiebreak keeps the catalogue's own order within a rank.
  scored.sort((a, b) => a.rank - b.rank || a.index - b.index);
  return scored.map((entry) => entry.option);
}
