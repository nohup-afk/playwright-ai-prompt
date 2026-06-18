/**
 * Prompt template — Playwright equivalent of cy-ai's LangChain PromptTemplate.
 */
export interface FailureContext {
  previousCode: string;
  error: string;
}

/**
 * Selector priority, modeled on Cypress's Element Selector API
 * (https://docs.cypress.io/api/cypress-api/element-selector-api).
 * The LLM is told to try these in order and stop at the first that matches an
 * element on the page — dedicated test attributes first, brittle CSS last.
 */
export const SELECTOR_PRIORITY = `Selector priority — choose the FIRST that exists on the target element, in this order:
   1. data-cy:       page.locator('[data-cy="<value>"]')
   2. data-test:     page.locator('[data-test="<value>"]')
   3. data-testid:   page.getByTestId('<value>')   (Playwright testIdAttribute is configured to data-testid)
   4. ARIA role + accessible name: page.getByRole('button', { name: '<text>' })
   5. label / placeholder:         page.getByLabel('<text>') / page.getByPlaceholder('<text>')
   6. visible text:                page.getByText('<text>')
   7. id:                          page.locator('#<id>')
   8. name attribute:              page.locator('[name="<name>"]')
   Do NOT use tag+class chains or auto-generated/hashed class names (e.g. .css-1ab2c3) — they are brittle.
   Pick the locator from the ACTUAL attributes present in the Page HTML below; never invent attributes.`;

export function buildPrompt(
  task: string,
  html: string,
  url: string,
  paramNames: string[],
  failure?: FailureContext,
): string {
  const paramsNote = paramNames.length
    ? `Dynamic values are available on a \`params\` object (do NOT hardcode them): ${paramNames
        .map((p) => `params.${p}`)
        .join(', ')}.`
    : '';

  const failureNote = failure
    ? `
A previous attempt at this step FAILED. Write DIFFERENT code that avoids the same mistake.
Re-check the Page HTML and pick a higher-priority selector (a data-* test attribute if one exists on the element).

Failed code:
\`\`\`js
${failure.previousCode}
\`\`\`

Error:
${failure.error}
`
    : '';

  return `You are writing one step of a Playwright E2E test.

Rules:
1. Return ONLY JavaScript code, inside a single \`\`\`js code block. No explanation.
2. The code is the BODY of an async function with these variables in scope:
   - page: Playwright Page (already on the right URL — never call page.goto unless the task says to navigate)
   - expect: Playwright expect
   - params: object with dynamic values
3. Do not use import/require, describe/it/test, or browser/context setup.
4. ${SELECTOR_PRIORITY}
5. For assertions use: await expect(locator).toBeVisible() / toHaveText() / toHaveValue() etc.
6. For a <select> dropdown use selectOption({ label: '<visible text>' }); do not click options.
7. Await every Playwright call. Keep the code minimal — only what the task requires.
${paramsNote}
${failureNote}
Task: ${task}

Current URL: ${url}

Page HTML:
\`\`\`html
${html}
\`\`\`
`;
}

/** Extract code from an LLM completion (handles fenced blocks or raw code). */
export function extractCode(completion: string): string {
  const fence = completion.match(/```(?:js|javascript|ts|typescript)?\s*\n([\s\S]*?)```/);
  const code = (fence ? fence[1] : completion).trim();
  if (!code) throw new Error('LLM returned empty code');
  return code;
}
