import { test, expect } from '@playwright/test';

import { addPerson, addItem, giveEveryoneAShare } from './helpers';

test.beforeEach(async ({ page }) => {
  // Clears before every script on the page runs, not just once — a plain
  // reload (or the redirect guard's own navigation) re-runs this too, so the
  // app always boots as a genuinely first-time visitor would see it.
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto('/');
});

test('creating a split, adding a person and an item produces a balance', async ({ page }) => {
  // Not `getByRole('link', { name: 'Split' })`: the tab carries an error-count
  // badge (`app.html`), so its accessible name is "Split 1" as soon as the
  // grid has anything to flag, e.g. items or people with no shares set yet.
  await page.locator('a.tab[href="#/split"]').click();

  // A brand-new split always starts with one sheet ("Expenses") already
  // present — see `emptyTrip()` in `core/trip-store.ts`.
  await expect(page.getByLabel('Sheet name')).toHaveValue('Expenses');

  await addPerson(page, 'Alice');
  const coffeeRow = await addItem(page, 'Coffee', '12');

  await expect(page.locator('.grand-amount')).toHaveText('$12.00');
  // Nobody has a share of it yet, so nobody owes anything.
  await expect(page.locator('.totals-band .cell.person.ledger-share')).toHaveText('$0.00');

  await giveEveryoneAShare(page, coffeeRow);

  await expect(page.locator('.totals-band .cell.person.ledger-share')).toHaveText('$12.00');
});
