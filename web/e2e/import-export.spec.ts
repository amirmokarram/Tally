import { test, expect } from '@playwright/test';

import { addPerson, addItem, giveEveryoneAShare } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto('/');
});

test('a split exported as JSON imports back with the same total', async ({ page }, testInfo) => {
  // Not `getByRole('link', { name: 'Split' })`: the tab carries an error-count
  // badge (`app.html`), which changes its accessible name to e.g. "Split 1".
  await page.locator('a.tab[href="#/split"]').click();
  await page.getByLabel('Split title').fill('Trip A');

  await addPerson(page, 'Alice');
  const coffeeRow = await addItem(page, 'Coffee', '12');
  await giveEveryoneAShare(page, coffeeRow);
  await expect(page.locator('.grand-amount')).toHaveText('$12.00');

  await page
    .getByTitle('Export this split as a JSON file or a PNG image', { exact: true })
    .click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByTitle('Download this split as a JSON file', { exact: true }).click();
  const download = await downloadPromise;
  const filePath = testInfo.outputPath('trip-a-export.json');
  await download.saveAs(filePath);

  // Simulate a fresh browser: the `beforeEach` init script clears storage on
  // this reload too, so the app re-seeds a clean, empty library.
  await page.reload();

  await page.locator('a.tab[href="#/splits"]').click();
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import from file…' }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles(filePath);

  // Exactly one split came in, so the app lands straight on it.
  await expect(page).toHaveURL(/#\/split$/);
  await expect(page.getByLabel('Split title')).toHaveValue('Trip A');
  await expect(page.locator('.grand-amount')).toHaveText('$12.00');

  // And it's saved in the library alongside the auto-seeded empty split
  // that was there before the import, not replacing it.
  await page.locator('a.tab[href="#/splits"]').click();
  const card = page.locator('li.card').filter({ hasText: 'Trip A' });
  await expect(card).toContainText('$12.00');
});
