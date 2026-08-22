import { test, expect } from '@playwright/test';

import { addPerson, addItem } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto('/');
});

test('dragging a range and pasting a single copied share fills the whole block', async ({
  page,
}) => {
  // README: "one value pasted over a block fills it, which is how a whole
  // column of shares is set at once." This is that flow, driven through the
  // app's own reimplementation of range select/clipboard (cell-range.ts) —
  // no AG Grid Enterprise range selection involved.
  await page.locator('a.tab[href="#/split"]').click();
  await addPerson(page, 'Alice');
  const coffeeRow = await addItem(page, 'Coffee', '12');
  const teaRow = await addItem(page, 'Tea', '6');

  const coffeeShare = coffeeRow.locator('[col-id^="person:"]');
  const teaShare = teaRow.locator('[col-id^="person:"]');

  // Type a share directly onto Coffee's cell: "1" fills the owe slot, pay
  // stays empty, which the resting cell shows as a bare "1" (see
  // `formatShare` in split-grid.ts).
  await coffeeShare.dblclick();
  await page.keyboard.press('1');
  await page.keyboard.press('Enter');
  await expect(coffeeShare).toHaveText('1');
  await expect(teaShare).toHaveText('');

  // Click it again to select it as a single resting cell — the anchor a
  // copy reads from — then copy it with the real browser clipboard, the
  // same event the app's own `(copy)` host listener reacts to.
  await coffeeShare.click();
  await page.keyboard.press('Control+c');

  // Drag-select the block from Coffee's share cell down through Tea's:
  // real mouse events over the two cells, the same gesture
  // `onCellMouseDown`/`onCellMouseOver` (split-grid.ts) are wired to, not a
  // synthetic dispatch standing in for it.
  const from = await coffeeShare.boundingBox();
  const to = await teaShare.boundingBox();
  if (!from || !to) {
    throw new Error('share cells not found');
  }
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2);
  await page.mouse.up();

  await page.keyboard.press('Control+v');

  // A single copied value repeats across the whole pasted-over block.
  await expect(coffeeShare).toHaveText('1');
  await expect(teaShare).toHaveText('1');
  await expect(page.locator('.totals-band .cell.person.ledger-share')).toHaveText('$18.00');
});
