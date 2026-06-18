import { expect, type Page } from '@playwright/test';
import type { StepParams } from './types';

/**
 * Execute generated step code with page/expect/params in scope.
 * Equivalent to how cy-ai evals the generated Cypress code.
 */
export async function executeStep(code: string, page: Page, params: StepParams): Promise<void> {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
    ...args: string[]
  ) => (page: Page, expectFn: typeof expect, params: StepParams) => Promise<void>;
  const fn = new AsyncFunction('page', 'expect', 'params', code);
  await fn(page, expect, params);
}

/**
 * Capture a compact HTML snapshot of the page for the LLM.
 * Drops non-semantic tags, comments, and whitespace runs — smaller prompts
 * mean much faster LLM prefill (especially on local llama.cpp).
 */
export async function captureHtml(page: Page, maxChars = 40_000): Promise<string> {
  const html = await page.evaluate(() => {
    const clone = document.documentElement.cloneNode(true) as HTMLElement;
    clone
      .querySelectorAll('script, style, svg, link, noscript, meta, iframe, video, audio, canvas')
      .forEach((el) => el.remove());
    return clone.outerHTML;
  });
  const compact = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s+/g, ' ')
    .replace(/> </g, '><')
    .trim();
  return compact.length > maxChars ? compact.slice(0, maxChars) + '<!-- truncated -->' : compact;
}
