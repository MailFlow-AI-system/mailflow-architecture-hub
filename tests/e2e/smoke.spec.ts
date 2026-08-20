import { expect, test } from '@playwright/test';

test('home route renders a meaningful document', async ({ page }) => {
  const response = await page.goto('/');

  expect(response?.ok()).toBe(true);
  await expect(page.locator('html')).toHaveAttribute('lang', /.+/);
  await expect(page.locator('main, body').first()).not.toBeEmpty();
  await expect(page).toHaveTitle(/.+/);
});
