import type { Page } from '@playwright/test';
import { StepCache } from './cache';
import { captureHtml, executeStep } from './executor';
import { buildPrompt, extractCode, type FailureContext } from './prompt-template';
import { resolveProvider } from './providers';
import type { AiOptions, CachedStep, LlmProvider, StepParams, StepResult } from './types';

const defaults = {
  log: process.env.PWAI_LOG !== '0',
  regenerate: process.env.PWAI_REGENERATE === '1',
  selfHeal: true,
  healAttempts: 2,
  timeout: Number(process.env.PWAI_TIMEOUT) || 120_000,
  cacheDir: process.env.PWAI_CACHE_DIR || '.pwai-cache',
};

let globalOptions: AiOptions = {};

/** Override default options globally (equivalent of cy.aiConfig). */
export function aiConfig(options: AiOptions): void {
  globalOptions = { ...globalOptions, ...options };
}

/**
 * Run natural-language test steps — Playwright port of cy.ai / cy.prompt
 * "Workflow 2: Continuous AI-powered testing":
 *
 * 1. Interpret: each step is sent to the LLM with the page HTML.
 * 2. Generate: the LLM returns Playwright code, which is executed.
 * 3. Cache: generated code is saved to .pwai-cache (commit it!) keyed by
 *    the step text, so later runs (any machine, CI) replay instantly
 *    without an LLM call.
 * 4. Self-heal: if code fails (cached OR freshly generated), the step is
 *    regenerated against the current page — with the failed code and the
 *    error message fed back to the LLM — up to `healAttempts` times, and
 *    the cache is updated with the working code.
 *
 * Placeholders: write steps like 'type "{{username}}" into the username
 * field' and pass { username } as params — values never invalidate the cache.
 */
export async function runAiSteps(
  page: Page,
  steps: string | string[],
  params: StepParams = {},
  options: AiOptions = {},
): Promise<StepResult[]> {
  const opts = { ...defaults, ...globalOptions, ...options };
  const cache = new StepCache(opts.cacheDir);
  const results: StepResult[] = [];

  let llm: LlmProvider | undefined = opts.llm;
  const getLlm = () => (llm ??= resolveProvider());
  const log = (msg: string) => opts.log && console.log(`  [pwai] ${msg}`);

  for (const step of Array.isArray(steps) ? steps : [steps]) {
    const cached = opts.regenerate ? undefined : cache.get(step);

    // 1. Cached path
    if (cached) {
      try {
        await executeStep(cached.code, page, params);
        log(`OK ${step}  (via cache)`);
        results.push({ step, code: cached.code, source: 'cache' });
        continue;
      } catch (err) {
        if (!opts.selfHeal) throw err;
        log(`FAIL cached step (${message(err)}) — self-healing: ${step}`);
        log(`cached code was:\n${indent(cached.code)}`);
        const entry = await generateUntilPasses(page, step, params, getLlm(), opts, cached, err, log);
        cache.set(entry);
        log(`OK ${step}  (self-healed via AI)`);
        results.push({ step, code: entry.code, source: 'self-healed' });
        continue;
      }
    }

    // 2. Fresh generation path (also self-heals its own failures)
    log(`generating with ${getLlm().name}/${getLlm().model}: ${step}`);
    const entry = await generateUntilPasses(page, step, params, getLlm(), opts, undefined, undefined, log);
    cache.set(entry);
    log(`OK ${step}  (via AI)`);
    results.push({ step, code: entry.code, source: 'ai' });
  }

  return results;
}

/**
 * Self-healing loop: generate code, execute it, and on failure regenerate
 * with the failed code + error fed back to the LLM, up to opts.healAttempts
 * extra attempts. Returns the first cache entry whose code executed cleanly.
 */
async function generateUntilPasses(
  page: Page,
  step: string,
  params: StepParams,
  llm: LlmProvider,
  opts: typeof defaults & AiOptions,
  failedCache: CachedStep | undefined,
  initialError: unknown,
  log: (msg: string) => void,
): Promise<CachedStep> {
  let failure: FailureContext | undefined =
    failedCache && initialError !== undefined
      ? { previousCode: failedCache.code, error: message(initialError) }
      : undefined;
  const baseHealCount = failedCache ? failedCache.healCount + 1 : 0;
  const maxAttempts = 1 + (opts.selfHeal ? opts.healAttempts : 0);
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const entry = await generate(page, step, params, llm, opts.timeout, baseHealCount + attempt - 1, failure);
    log(`attempt ${attempt}/${maxAttempts} generated code:\n${indent(entry.code)}`);
    try {
      await executeStep(entry.code, page, params);
      return entry;
    } catch (err) {
      lastError = err;
      failure = { previousCode: entry.code, error: message(err) };
      if (attempt < maxAttempts) {
        log(`FAIL attempt ${attempt}/${maxAttempts} (${message(err)}) — regenerating: ${step}`);
      }
    }
  }

  throw new Error(
    `[pwai] step failed after ${maxAttempts} AI attempt(s): "${step}"\nLast error: ${message(lastError)}`,
    { cause: lastError },
  );
}

async function generate(
  page: Page,
  step: string,
  params: StepParams,
  llm: LlmProvider,
  timeoutMs: number,
  healCount: number,
  failure?: FailureContext,
): Promise<CachedStep> {
  const html = await captureHtml(page);
  const prompt = buildPrompt(step, html, page.url(), Object.keys(params), failure);
  const completion = await llm.generate(prompt, { timeoutMs });
  return {
    step,
    code: extractCode(completion),
    provider: llm.name,
    model: llm.model,
    url: page.url(),
    generatedAt: new Date().toISOString(),
    healCount,
  };
}

function message(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const lines = err.message.split('\n');
  // Playwright puts the selector on a follow-up line ("waiting for locator(...)")
  const locatorLine = lines.slice(1).find((l) => /waiting for|locator\(|getBy[A-Z]/.test(l));
  return locatorLine ? `${lines[0]} ${locatorLine.trim()}` : lines[0];
}

/** Indent generated code for readable log output. */
function indent(code: string): string {
  return code.split('\n').map((l) => `      | ${l}`).join('\n');
}
