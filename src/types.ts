import type { Page } from '@playwright/test';

/** Parameters passed to a generated step (placeholder values). */
export type StepParams = Record<string, string | number | boolean>;

/** A pluggable LLM provider. */
export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  /** Send a prompt, return raw completion text. */
  generate(prompt: string, options?: { timeoutMs?: number }): Promise<string>;
}

/** Options for the ai()/prompt() fixture (mirrors cy.ai / cy.prompt options). */
export interface AiOptions {
  /** Custom LLM provider. Defaults to env-configured provider (PWAI_PROVIDER). */
  llm?: LlmProvider;
  /** Display command logs. Default true (or PWAI_LOG=0). */
  log?: boolean;
  /** Force regeneration, ignoring cache. Default false (or PWAI_REGENERATE=1). */
  regenerate?: boolean;
  /** Self-heal: regenerate with AI when cached code fails. Default true. */
  selfHeal?: boolean;
  /**
   * Max AI regeneration attempts per step when code fails. Each attempt
   * feeds the failed code + error back to the LLM. Default 2.
   */
  healAttempts?: number;
  /** LLM timeout in ms. Default 2 minutes. */
  timeout?: number;
  /** Cache directory. Default ".pwai-cache". */
  cacheDir?: string;
}

/** A cached, generated step. */
export interface CachedStep {
  step: string;
  code: string;
  provider: string;
  model: string;
  url: string;
  generatedAt: string;
  healCount: number;
}

export interface StepResult {
  step: string;
  code: string;
  /** How the step ran: from cache, freshly generated, or self-healed. */
  source: 'cache' | 'ai' | 'self-healed';
}

export type AiFn = (
  steps: string | string[],
  params?: StepParams,
  options?: AiOptions,
) => Promise<StepResult[]>;

export interface AiContext {
  page: Page;
  testTitle: string;
}
