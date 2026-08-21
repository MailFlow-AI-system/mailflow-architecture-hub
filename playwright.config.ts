import { defineConfig, devices } from '@playwright/test';

const testHost = process.env.PLAYWRIGHT_HOST ?? '127.0.0.1';
const testPort = process.env.PLAYWRIGHT_PORT ?? '4322';
const testBaseUrl = process.env.PLAYWRIGHT_BASE_URL ?? `http://${testHost}:${testPort}`;

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: testBaseUrl,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `bun run preview --host ${testHost} --port ${testPort}`,
    env: { ASTRO_PREVIEW_BACKGROUND: '1' },
    reuseExistingServer: false,
    timeout: 120_000,
    url: testBaseUrl,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
