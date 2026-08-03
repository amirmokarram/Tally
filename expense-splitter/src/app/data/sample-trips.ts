/**
 * The four worked examples from the original user guide, rebuilt as data.
 *
 * They double as documentation and as regression fixtures: every expected
 * balance in `split-engine.spec.ts` is taken straight from the guide's
 * screenshots, so if the engine ever drifts from the spreadsheet the tests say so.
 */

import {
  DEFAULT_CURRENCY,
  ExpenseSheet,
  Person,
  Share,
  Trip,
  amountCharge,
  percentCharge,
} from '../models/trip.model';

export type SampleTripId =
  | 'restaurant'
  | 'camping'
  | 'new-england'
  | 'debt-simplification';

export interface SampleTripInfo {
  id: SampleTripId;
  title: string;
  blurb: string;
}

export const SAMPLE_TRIPS: readonly SampleTripInfo[] = [
  {
    id: 'restaurant',
    title: 'Restaurant check',
    blurb: 'One check, three people, tax and tip. Nobody marked as payer, so each person is simply charged their share.',
  },
  {
    id: 'camping',
    title: 'Camping trip',
    blurb: 'Everyone bought something. Uses the "owes . paid" cells so the split resolves both directions at once.',
  },
  {
    id: 'new-england',
    title: 'Trip to New England',
    blurb: 'Several checks across four expense sheets, with sheet-level payers and a Groupon discount.',
  },
  {
    id: 'debt-simplification',
    title: 'Debt simplification',
    blurb: 'Seven people whose balances break into two independent groups, cutting the number of transfers.',
  },
];

/** Terse builder so the fixtures below read like the spreadsheet screenshots. */
interface SheetSpec {
  name: string;
  paidBy?: string[];
  tax?: number | string;
  tip?: number | string;
  discount?: number | string;
  /** `[item, amount, ...shares]`, one share per person in people order. */
  items: [string, number, ...(number | null)[]][];
  currency?: string;
  rate?: number | null;
}

function charge(value: number | string | undefined) {
  if (value === undefined) {
    return amountCharge(0);
  }
  if (typeof value === 'string' && value.trim().endsWith('%')) {
    return percentCharge(parseFloat(value) / 100);
  }
  return amountCharge(Number(value));
}

function build(
  title: string,
  baseCurrency: string,
  names: string[],
  specs: SheetSpec[],
): Trip {
  let counter = 0;
  const id = (prefix: string) => `${prefix}${(counter += 1)}`;

  const people: Person[] = names.map((name) => ({ id: id('p'), name }));
  const byName = new Map(people.map((p) => [p.name, p.id]));
  const shares: Record<string, Record<string, Share>> = {};

  const sheets: ExpenseSheet[] = specs.map((spec) => {
    const sheet: ExpenseSheet = {
      id: id('s'),
      name: spec.name,
      currency: spec.currency ?? DEFAULT_CURRENCY,
      rateOverride: spec.rate ?? null,
      paidBy: (spec.paidBy ?? []).map((name) => byName.get(name)!),
      tax: charge(spec.tax),
      tip: charge(spec.tip),
      discount: charge(spec.discount),
      items: [],
    };

    for (const [name, amount, ...cells] of spec.items) {
      const itemId = id('i');
      sheet.items.push({ id: itemId, name, amount });

      const row: Record<string, Share> = {};
      cells.forEach((cell, index) => {
        if (cell == null) {
          return;
        }
        const owe = Math.trunc(cell);
        const pay = Math.round((cell - owe) * 10);
        if (owe || pay) {
          row[people[index].id] = { owe, pay };
        }
      });
      if (Object.keys(row).length) {
        shares[itemId] = row;
      }
    }

    return sheet;
  });

  return { title, baseCurrency, people, sheets, shares };
}

export function buildSampleTrip(id: SampleTripId): Trip {
  switch (id) {
    case 'restaurant':
      return restaurantCheck();
    case 'camping':
      return campingTrip();
    case 'new-england':
      return newEnglandTrip();
    case 'debt-simplification':
      return debtSimplification();
  }
}

/** Guide scenario 1 — expected balances: Jack 33.07, Chris 60.52, Rose 15.64. */
function restaurantCheck(): Trip {
  return build('Cheesecake Factory', 'USD', ['Jack', 'Chris', 'Rose'], [
    {
      name: 'Expenses',
      tax: 5.61,
      tip: '15%',
      items: [
        ['Beer', 15.0, 1, 1, null],
        ['Pizza', 19.8, 1, 3, 4],
        ['Burger', 17.3, 1, null, null],
        ['Steak', 32.0, null, 1, null],
        ['Coke', 6.0, null, 1, 1],
      ],
    },
  ]);
}

/**
 * Guide scenario 2 — expected balances:
 * Jack 43.46, Rich (58.95), Emily 12.69, Jane 2.48, Bill 2.67, Chris (2.35).
 */
function campingTrip(): Trip {
  return build(
    'Camping',
    'USD',
    ['Jack', 'Rich', 'Emily', 'Jane', 'Bill', 'Chris'],
    [
      {
        name: 'Expenses',
        items: [
          ['Campsite', 110.0, 1, 1.1, 1, 1, 1, 1],
          ['Charcoal', 9.91, 1.1, 1, 1, null, null, 1],
          ['Firewood', 10.0, 1.1, 1, 1, 1, 1, 1],
          ['Beef', 70.0, 2, 1, 1.1, null, null, 1.1],
          ['Coke', 25.2, 1, 1, 1, 0.1, null, null],
          ['Mosquito Repellent', 5.04, 1.1, 1, 1.2, 1, 1, 1],
          ['Bread', 15.0, 1, 1, 1, 1, 1.1, 1],
          ['Cheese', 10.0, null, null, null, 1, 1, 0.1],
          ['Eggs', 10.0, 1, 1, 1, 1, 1.1, 1],
          ['Oil', 7.0, 1, 1, 1, 1.1, 1.1, 1],
        ],
      },
    ],
  );
}

/**
 * Guide scenario 3 — expected balances:
 * Harry 132.54, Rich 120.37, Joe (783.24), Chris 401.15, Will 129.18.
 */
function newEnglandTrip(): Trip {
  return build(
    'Trip to New England',
    'USD',
    ['Harry', 'Rich', 'Joe', 'Chris', 'Will'],
    [
      {
        name: 'General',
        items: [
          ['Plane Tickets', 960.56, 1, 1, 1.1, 2, 1],
          ['Parking Manchstr', 32.0, 1.1, 1, 1, 2, 1],
          ['Icecream', 30.0, 1.1, 1, null, 1, 1],
          ['water', 11.0, 1, 1.1, 1, 1, 1],
          ['cash lend', 40.0, 1, null, 0.1, null, null],
        ],
      },
      {
        name: 'McDonalds',
        paidBy: ['Rich'],
        tax: 5.73,
        tip: '15%',
        items: [
          ['Burgers', 24.6, null, null, null, 1, null],
          ['Coke', 7.0, null, 1, null, null, 1],
          ['Potato', 13.95, 1, 1, null, null, 1],
          ['Chickenburger', 26.0, 1, null, 1, null, null],
        ],
      },
      {
        name: 'Peruvian',
        paidBy: ['Will'],
        tax: '6.25%',
        tip: 16.0,
        discount: 5.0,
        items: [
          ['Empanadas', 14.0, null, null, null, null, 1],
          ['Anticucho', 13.0, null, 1, null, null, null],
          ['Ceviche Mixsto', 19.0, null, null, 1, null, null],
          ['Tiradito Exotico', 17.0, null, null, null, 1, null],
          ['Tiradito Bandera', 19.0, null, null, null, 1, null],
          ['Sodas', 15.0, null, null, null, null, 1],
        ],
      },
      {
        name: 'Cheesecake Factory',
        paidBy: ['Chris', 'Harry'],
        tax: 7.44,
        tip: '20%',
        items: [
          ['California Salad', 15.0, null, 1, null, null, null],
          ['Cacio Pepe Pasta', 22.0, null, null, null, 1, null],
          ['Spicy Rigatoni', 19.0, null, null, null, null, 1],
          ['Ahi Tuna', 26.0, 1, null, null, null, null],
          ['Peach Lemonade', 9.0, null, null, 1, null, null],
          ['Carne Asada Steak', 28.0, null, null, null, 1, null],
        ],
      },
    ],
  );
}

/**
 * Guide's debt-simplification example — expected balances:
 * Henry (0.90), Harry (9.61), Joe 6.52, Dave 15.18, Rich (5.67), Bill (8.61), Jeff 3.09.
 * These split into {Harry, Joe, Jeff} and {Henry, Dave, Rich, Bill}.
 */
function debtSimplification(): Trip {
  return build(
    'Debt Simplification',
    'USD',
    ['Henry', 'Harry', 'Joe', 'Dave', 'Rich', 'Bill', 'Jeff'],
    [
      {
        name: 'Expenses',
        tax: 4.96,
        tip: 12.75,
        items: [
          ['BBQ Bacon Burger', 13.95, 1.1, null, null, 1, 1, null, null],
          ['Greek Salad', 10.25, null, 1.1, null, null, 1, 1, 1],
          ['Mozzarella Sticks', 7.5, 1, null, 1.1, 1, 2, null, null],
          ['Shrimp Tacos', 14.75, 1, null, 1, null, 0.1, 1, 2],
          ['Turkey Club', 12.4, 1, null, 2, null, null, 0.1, null],
          ['Margherita Pizza', 11.99, null, null, null, 1, null, null, 1.1],
        ],
      },
    ],
  );
}
