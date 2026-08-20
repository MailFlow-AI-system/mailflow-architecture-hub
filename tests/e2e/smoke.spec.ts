import { expect, test } from '@playwright/test';

test('home route exposes the source-of-truth navigation', async ({ page }) => {
  const response = await page.goto('/');

  expect(response?.ok()).toBe(true);
  await expect(page.locator('html')).toHaveAttribute('lang', /.+/);
  await expect(page.locator('main, body').first()).not.toBeEmpty();
  await expect(page).toHaveTitle(/.+/);
  await expect(page.getByRole('link', { name: 'Explorer', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Decisions', exact: true })).toBeVisible();
});

test('decision catalog reaches exact baseline evidence and reverse diagram links', async ({
  page,
}) => {
  await page.goto('/decisions/');
  const firstDecision = page.locator('.entity-card h2 a').first();
  await expect(firstDecision).toBeVisible();
  await firstDecision.click();
  await expect(
    page.getByRole('heading', { name: 'Authoritative baseline evidence' }),
  ).toBeVisible();
  await expect(page.locator('pre').first()).not.toBeEmpty();
  await expect(page.getByText('Diagrams', { exact: true })).toBeVisible();
});

test('explorer filters, selects, and persists state in the URL', async ({ page }) => {
  await page.goto('/explorer/diagram.context.general/');
  await expect(page.locator('.react-flow')).toBeVisible();
  await page.getByLabel('Phase').selectOption('future');
  await expect(page).toHaveURL(/phase=future/u);
  const node = page.locator('.react-flow__node').first();
  await node.click();
  await expect(page).toHaveURL(/node=/u);
  await expect(page.locator('.explorer-inspector h2')).not.toHaveText('Select a node');
});

test('mobile routes retain useful static diagram content', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/explorer/diagram.security.browser-auth.mvp/');
  await expect(page.getByRole('heading', { name: 'Static architecture outline' })).toBeVisible();
  await page.locator('.mobile-nav summary').click();
  await expect(page.locator('.mobile-nav__links')).toBeVisible();
});
