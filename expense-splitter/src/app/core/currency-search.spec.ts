import { CURRENCIES } from '../data/currencies';
import { searchCurrencies } from './currency-search';

const codes = (query: string) => searchCurrencies(CURRENCIES, query).map((c) => c.code);

describe('searchCurrencies', () => {
  it('returns the whole catalogue, in order, for a blank query', () => {
    expect(searchCurrencies(CURRENCIES, '   ')).toEqual([...CURRENCIES]);
  });

  it('puts an exact code first, ahead of names containing the same letters', () => {
    // "European"-ish names and codes like NEUR would otherwise crowd it out.
    expect(codes('eur')[0]).toBe('EUR');
    expect(codes('usd')[0]).toBe('USD');
    expect(codes('huf')[0]).toBe('HUF');
  });

  it('finds a currency by part of its name', () => {
    expect(codes('forint')).toEqual(['HUF']);
    expect(codes('zloty')).toEqual(['PLN']);
  });

  it('matches a word in the middle of a name', () => {
    expect(codes('rupee')).toContain('INR');
    expect(codes('rupee')).toContain('PKR');
  });

  it('ranks a code prefix above a name match', () => {
    // CAD, CAN... vs "Canadian Dollar", "Caymanian Dollar".
    const result = codes('ca');
    expect(result.indexOf('CAD')).toBeLessThan(result.indexOf('CVE'));
  });

  it('combines several words with AND, across code and name', () => {
    expect(codes('canadian dollar')).toEqual(['CAD']);
    expect(codes('dollar aud')).toEqual(['AUD']);
  });

  it('ignores case and accents', () => {
    expect(codes('bolivian boliviano')).toEqual(['BOB']);
    expect(codes('BOLÍVIANO')).toEqual(['BOB']);
  });

  it('returns nothing when there is no match', () => {
    expect(codes('quatloo')).toEqual([]);
  });

  it('searches whatever list it is handed, not the catalogue', () => {
    const options = [{ code: 'DEFAULT', name: 'Default (USD)' }];
    expect(searchCurrencies(options, 'default')).toEqual(options);
    expect(searchCurrencies(options, 'euro')).toEqual([]);
  });
});
