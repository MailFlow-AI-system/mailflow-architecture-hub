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
  const evidence = page.locator('.markdown-content').first();
  await expect(evidence).not.toBeEmpty();
  await expect(evidence).not.toContainText('###');
  await expect(evidence.locator('p, h3, ul, ol, table, blockquote').first()).toBeVisible();
  await expect(page.getByText('Diagrams', { exact: true })).toBeVisible();
});

test('explorer filters, selects, and persists state in the URL', async ({ page }) => {
  await page.goto('/explorer/diagram.context.general/');
  await expect(page.locator('.react-flow')).toBeVisible();
  const firstNodeWidth = await page
    .locator('.react-flow__node')
    .first()
    .evaluate((node) => Number.parseFloat(getComputedStyle(node).width));
  expect(firstNodeWidth).toBeGreaterThanOrEqual(256);
  await expect(page.locator('.react-flow__edge-text')).toHaveCount(0);
  const layoutSteps = await page.locator('.react-flow__node').evaluateAll((nodes) => {
    const positions = nodes.map((node) => {
      const match = node.getAttribute('style')?.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/u);
      return { x: Number(match?.[1]), y: Number(match?.[2]) };
    });
    const minimumStep = (values: number[]) => {
      const unique = [...new Set(values)].sort((left, right) => left - right);
      return Math.min(...unique.slice(1).map((value, index) => value - unique[index]));
    };
    return {
      column: minimumStep(positions.map(({ x }) => x)),
      row: minimumStep(positions.map(({ y }) => y)),
    };
  });
  expect(layoutSteps.column).toBeGreaterThanOrEqual(390);
  expect(layoutSteps.row).toBeGreaterThanOrEqual(190);
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

test('whole architecture explorer exposes complete and MVP canvas modes', async ({ page }) => {
  await page.goto('/explorer/whole/');
  await expect(page.getByRole('heading', { name: 'Complete architecture canvas' })).toBeVisible();
  await expect(page.locator('.architecture-explorer--whole .react-flow')).toBeVisible();
  const initialScale = await page
    .locator('.architecture-explorer--whole .react-flow__viewport')
    .evaluate((viewport) => new DOMMatrixReadOnly(getComputedStyle(viewport).transform).a);
  expect(initialScale).toBeGreaterThanOrEqual(0.55);
  const allNodeCount = await page
    .locator('.architecture-explorer--whole .react-flow__node')
    .count();
  const allEdgeCount = await page
    .locator('.architecture-explorer--whole .react-flow__edge')
    .count();
  await expect(page.locator('[data-whole-node-count]')).toHaveText(String(allNodeCount));
  await expect(page.locator('[data-whole-edge-count]')).toHaveText(String(allEdgeCount));
  expect(allNodeCount).toBeGreaterThan(100);
  expect(allEdgeCount).toBeGreaterThan(200);

  await page.getByLabel('Architecture scope').selectOption('mvp');
  await expect(page).toHaveURL(/mode=mvp/u);
  const mvpCanvas = page.locator('.architecture-explorer--whole');
  const mvpNodeCount = await mvpCanvas.locator('.react-flow__node').count();
  const mvpEdgeCount = await mvpCanvas.locator('.react-flow__edge').count();
  expect(mvpNodeCount).toBeGreaterThan(0);
  expect(mvpEdgeCount).toBeGreaterThan(0);
  expect(mvpNodeCount).toBeLessThan(allNodeCount);
  expect(mvpEdgeCount).toBeLessThan(allEdgeCount);
  await expect(mvpCanvas.getByText('Core API', { exact: true })).toBeVisible();
  await expect(mvpCanvas.getByText('pg-boss worker queue', { exact: true })).toBeVisible();
  await expect(mvpCanvas.getByText('Billing', { exact: true })).toHaveCount(0);
  await expect(
    mvpCanvas.getByText('Stripe Checkout / Portal / Billing', { exact: true }),
  ).toHaveCount(0);
  await expect(mvpCanvas.getByText('RabbitMQ', { exact: true })).toHaveCount(0);
  await expect(mvpCanvas.getByText('Redis', { exact: true })).toHaveCount(0);
  const serviceFilter = page.getByLabel('Service');
  await expect(serviceFilter.locator('option[value="service.identity-workspace"]')).toHaveCount(1);
  await expect(serviceFilter.locator('option[value="service.mail"]')).toHaveCount(1);
  await expect(serviceFilter.locator('option[value="service.gateway-bff"]')).toHaveCount(0);
  await expect(serviceFilter.locator('option[value="service.audience"]')).toHaveCount(0);
  await expect(serviceFilter.locator('option[value="service.billing"]')).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: /^async command$/iu })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: /^trust boundary$/iu })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: /^job$/iu })).toBeVisible();

  await page.getByLabel('Architecture scope').selectOption('all');
  await expect(page).toHaveURL(/mode=all/u);
  await expect(page.locator('.architecture-explorer--whole .react-flow__node')).toHaveCount(
    allNodeCount,
  );
  await expect(serviceFilter.locator('option[value="service.billing"]')).toHaveCount(1);
  await expect(page.getByRole('checkbox', { name: /^async command$/iu })).toBeVisible();
});

test('whole architecture canvas keeps scope controls usable on small screens', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/explorer/whole/');
  await expect(page.getByLabel('Architecture scope')).toBeVisible();
  await expect(page.locator('.architecture-explorer--whole .react-flow')).toBeVisible();
  const canvas = await page.locator('.architecture-explorer--whole .explorer-canvas').boundingBox();
  expect(canvas?.width).toBeGreaterThan(0);
  await expect(page.locator('.architecture-explorer--whole .explorer-inspector')).toBeVisible();
});

test('focused and whole canvases enter and exit a viewport-filling mode', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });

  for (const route of ['/explorer/diagram.context.general/', '/explorer/whole/']) {
    await page.goto(route);
    await page.locator('.react-flow').waitFor();

    const expandButton = page.getByRole('button', { name: 'Expand architecture canvas' });
    await expandButton.click();

    const canvas = page.locator('.explorer-canvas--fullscreen');
    await expect(canvas).toBeVisible();
    const fullscreenBox = await canvas.boundingBox();
    expect(fullscreenBox).toMatchObject({ x: 0, y: 0, width: 1280, height: 800 });
    await expect(page.locator('.explorer-filters')).toHaveAttribute('aria-hidden', 'true');

    const closeButton = page.getByRole('button', { name: 'Close fullscreen canvas' });
    await expect(closeButton).toBeFocused();
    await closeButton.click();

    await expect(canvas).toHaveCount(0);
    await expect(expandButton).toBeFocused();
  }
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
