import { test, expect } from '@playwright/test';

import { addItem } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto('/');
});

test('ticking two lines and deleting them removes both', async ({ page }) => {
  // Not `getByRole('link', { name: 'Split' })`: the tab carries an error-count
  // badge (`app.html`), which changes its accessible name to e.g. "Split 1".
  await page.locator('a.tab[href="#/split"]').click();

  await addItem(page, 'Coffee', '12');
  await addItem(page, 'Tea', '6');
  await expect(page.locator('.grand-amount')).toHaveText('$18.00');

  // A plain click on the index cell *replaces* the tick with just that one
  // line (Explorer/Gmail convention — see `onCellMouseDown` in
  // `split-grid.ts`), so picking up both lines needs a Shift+click to extend
  // the range, not two independent plain clicks.
  const itemRows = page.locator('.ag-row[row-id^="item:"]');
  await itemRows.filter({ hasText: 'Coffee' }).locator('[col-id="index"]').click();
  await itemRows.filter({ hasText: 'Tea' }).locator('[col-id="index"]').click({ modifiers: ['Shift'] });

  await page.getByTitle('Delete ticked lines', { exact: true }).click();

  await expect(itemRows).toHaveCount(0);
  await expect(page.locator('.grand-amount')).toHaveText('$0.00');
});
