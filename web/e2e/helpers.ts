/**
 * Small shared steps for the ledger flows every spec in this folder starts
 * from. Not a Playwright fixture — just the handful of clicks that would
 * otherwise be copy-pasted into every spec.
 *
 * Selectors lean on two things AG Grid already renders without any app
 * changes: `row-id` (from the app's own `getRowId`, e.g. `item:<id>`,
 * `add-item:<sheetId>`) and `col-id` (from each column's `colId`, e.g.
 * `item`, `amount`, `index`). See `ledgerRowId` in `components/ledger-model.ts`.
 */
import { Locator, Page } from '@playwright/test';

/**
 * Opens the Add menu and adds a person, then names them.
 *
 * Not `getByTitle('Add person')`: the grid's own add-person column header
 * (`person-header.ts`'s `AddPersonHeader`) carries the identical
 * `title="Add person"` on its icon-only button, so that locator matches two
 * elements at once whenever this dropdown is open. The dropdown item's
 * visible text — "Add Person", capital P — is what actually disambiguates
 * it, since the icon-only button has no text content of its own.
 */
export async function addPerson(page: Page, name: string): Promise<void> {
  await page.getByTitle('Add a sheet or a person', { exact: true }).click();
  await page.getByRole('button', { name: 'Add Person', exact: true }).click();
  await page.getByLabel(/Person \d+ name/).last().fill(name);
}

/**
 * Types a new line into the sheet's "+ Add item" row and gives it an amount.
 * Returns a locator for the resulting item row, matched by its name — safe
 * as long as item names in a test are unique.
 */
export async function addItem(page: Page, name: string, amount: string): Promise<Locator> {
  const addItemRow = page.locator('.ag-row[row-id^="add-item:"]');
  const itemCell = addItemRow.locator('[col-id="item"]');
  await itemCell.dblclick();
  await itemCell.locator('input').fill(name);
  await page.keyboard.press('Enter');

  const row = page.locator('.ag-row[row-id^="item:"]').filter({ hasText: name });
  const amountCell = row.locator('[col-id="amount"]');
  await amountCell.dblclick();
  await amountCell.locator('input').fill(amount);
  await page.keyboard.press('Enter');

  return row;
}

/** Ticks a line (clicking its index cell) and gives everyone an equal share of it. */
export async function giveEveryoneAShare(page: Page, row: Locator): Promise<void> {
  await row.locator('[col-id="index"]').click();
  await page.getByTitle('Set shares for ticked lines', { exact: true }).click();
  await page.getByTitle('Give everyone an equal share of the ticked lines', { exact: true }).click();
}
