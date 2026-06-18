import { test as base } from '@playwright/test';
import { runAiSteps } from './ai';
import type { AiFn } from './types';

/**
 * Playwright test with the `ai` fixture:
 *
 *   import { test, expect } from '../src/fixtures';
 *
 *   test('login', async ({ page, ai }) => {
 *     await page.goto('https://www.saucedemo.com');
 *     await ai([
 *       'type "{{username}}" into the username field',
 *       'type "{{password}}" into the password field',
 *       'click the login button',
 *       'verify the products page is shown',
 *     ], { username: 'standard_user', password: 'secret_sauce' });
 *   });
 */
export const test = base.extend<{ ai: AiFn }>({
  ai: async ({ page }, use) => {
    await use((steps, params, options) => runAiSteps(page, steps, params, options));
  },
});

export { expect } from '@playwright/test';
export { aiConfig } from './ai';
export * from './providers';
export type * from './types';
