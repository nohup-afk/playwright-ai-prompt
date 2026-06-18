/**
 * Prompt template — Playwright equivalent of cy-ai's LangChain PromptTemplate.
 */
export interface FailureContext {
  previousCode: string;
  error: string;
}

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
4. Prefer resilient, user-facing locators: page.getByRole, page.getByLabel, page.getByPlaceholder, page.getByText. Fall back to CSS/data-test attributes only when needed.
5. For assertions use: await expect(locator).toBeVisible() / toHaveText() / toHaveValue() etc.
6. Await every Playwright call. Keep the code minimal — only what the task requires.
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
