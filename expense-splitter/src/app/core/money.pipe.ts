import { Pipe, PipeTransform } from '@angular/core';

import { round } from './split-engine';

/**
 * Formats an amount the way the spreadsheet did: symbol, thousands separators,
 * two decimals, and negatives in parentheses rather than with a minus sign —
 * that is how a person who is *owed* money appears on the Split sheet.
 */
@Pipe({ name: 'money' })
export class MoneyPipe implements PipeTransform {
  transform(value: number | null | undefined, symbol = '', parens = true): string {
    if (value == null || !Number.isFinite(value)) {
      return '';
    }
    const rounded = round(value, 2);
    const text =
      symbol +
      Math.abs(rounded).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

    if (rounded >= 0) {
      return text;
    }
    return parens ? `(${text})` : `-${text}`;
  }
}
