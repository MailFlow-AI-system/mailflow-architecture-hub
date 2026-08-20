import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:4322',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'bun run preview --host 127.0.0.1 --port 4322',
    env: { ASTRO_PREVIEW_BACKGROUND: '1' },
    reuseExistingServer: false,
    timeout: 120_000,
    url: 'http://127.0.0.1:4322',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
