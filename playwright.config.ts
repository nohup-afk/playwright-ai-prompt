import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  // AI generation can be slow on first (uncached) runs
  timeout: 5 * 60 * 1000,
  expect: { timeout: 15_000 },
  retries: 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
