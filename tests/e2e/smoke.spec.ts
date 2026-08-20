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
  await page.getByLabel('Service').selectOption({ index: 1 });
  await expect(page).toHaveURL(/service=/u);
  await page.getByLabel('Service').selectOption('');
  await page.locator('.explorer-filters fieldset input').first().check();
  await expect(page).toHaveURL(/types=/u);
  await page.locator('.explorer-filters fieldset input').first().uncheck();
  await page.getByLabel('Find node').fill('no-such-architecture-node');
  await expect(page.getByText('No elements match these filters.')).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page.locator('.react-flow')).toBeVisible();
  const node = page.locator('.react-flow__node').first();
  await node.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/node=/u);
  await expect(page.locator('.explorer-inspector h2')).not.toHaveText('Select a node');
  await page.goto('/explorer/diagram.capability.mail-provider-ownership/');
  const mailNode = page.locator('.react-flow__node', { hasText: 'Mail service' });
  await mailNode.focus();
  await page.keyboard.press('Enter');
  const inspectorLink = page.locator('.explorer-inspector a[href="/services/service.mail/"]');
  await expect(inspectorLink).toBeVisible();
  await inspectorLink.click();
  await expect(page).toHaveURL('/services/service.mail/');
  await expect(page.getByRole('heading', { name: 'Mail' })).toBeVisible();
});

test('production search resolves architecture records and preserves the query', async ({
  page,
}) => {
  await page.goto('/search/?q=Resend');
  await expect(page.locator('[data-search-status]')).toContainText(/results? for “Resend”/u);
  await expect(page.locator('[data-search-results] a').first()).toBeVisible();
  await expect(page).toHaveURL(/q=Resend/u);
});

test('mobile routes retain useful static diagram content', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/explorer/diagram.security.browser-auth.mvp/');
  const headingRightEdge = await page.locator('h1').evaluate((heading) => {
    const range = document.createRange();
    range.selectNodeContents(heading);
    return range.getBoundingClientRect().right;
  });
  expect(headingRightEdge).toBeLessThanOrEqual(390);
  await expect(page.getByRole('heading', { name: 'Static architecture outline' })).toBeVisible();
  await page.locator('.mobile-nav summary').click();
  await expect(page.locator('.mobile-nav__links')).toBeVisible();
});

test('unknown architecture routes retain recovery navigation', async ({ page }) => {
  const response = await page.goto('/explorer/not-real/');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'This route is outside the map.' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Visual explorer' })).toBeVisible();
});
