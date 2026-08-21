import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

for (const route of [
  '/',
  '/decisions/',
  '/coverage/',
  '/explorer/diagram.context.general/',
  '/explorer/whole/',
]) {
  test(`${route} has no automated accessibility violations @a11y`, async ({ page }) => {
    await page.goto(route);
    if (route.startsWith('/explorer/')) await page.locator('.react-flow').waitFor();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
}

test('explorer respects reduced motion and remains keyboard reachable @a11y', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/explorer/diagram.context.general/');
  const firstNode = page.locator('.react-flow__node').first();
  await firstNode.focus();
  await expect(firstNode).toBeFocused();
  await expect(firstNode).toHaveCSS('transition-duration', '0s');
});

test('whole semantic domains remain keyboard reachable @a11y', async ({ page }) => {
  await page.goto('/explorer/whole/');
  const domain = page.getByRole('button', { name: /mail delivery/i }).first();
  await domain.focus();
  await expect(domain).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/domain=mail-delivery/u);
  await expect(page.locator('.architecture-entity-node')).not.toHaveCount(0);
  await expect(page.locator('.architecture-legend')).toBeVisible();
});

test('fullscreen canvas traps focus, supports Escape, and remains accessible @a11y', async ({
  page,
}) => {
  await page.goto('/explorer/diagram.context.general/');
  const expandButton = page.getByRole('button', { name: 'Expand architecture canvas' });
  await expandButton.click();

  const closeButton = page.getByRole('button', { name: 'Close fullscreen canvas' });
  await expect(closeButton).toBeFocused();
  const results = await new AxeBuilder({ page }).include('.explorer-canvas--fullscreen').analyze();
  expect(results.violations).toEqual([]);

  await page.keyboard.press('Escape');
  await expect(page.locator('.explorer-canvas--fullscreen')).toHaveCount(0);
  await expect(expandButton).toBeFocused();
});
