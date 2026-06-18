import { defineConfig } from '@playwright/test';
import 'dotenv/config';

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
    baseURL: process.env.BASE_URL || 'https://www.saucedemo.com',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // page.getByTestId() matches this attribute (see selector priority in prompt-template.ts)
    testIdAttribute: 'data-testid',
  },
});
