import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

for (const route of ['/', '/decisions/', '/coverage/', '/explorer/diagram.context.general/']) {
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
