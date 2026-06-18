import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { runAiSteps } from '../src/ai';
import { StepCache } from '../src/cache';
import { captureHtml } from '../src/executor';
import { resolveProvider } from '../src/providers';
import type { LlmProvider, StepParams } from '../src/types';
import { buildPlannerPrompt, parseDecision } from './planner';

export interface AgentOptions {
  goal: string;
  url: string;
  /** Max planner iterations. Default 15. */
  maxSteps?: number;
  /** Consecutive step failures before giving up. Default 3. */
  maxConsecutiveFailures?: number;
  /** Ignore any saved plan and re-plan from scratch. Default false. */
  replan?: boolean;
  /** LLM timeout per planner call, ms. Default PWAI_TIMEOUT or 300000. */
  timeout?: number;
  llm?: LlmProvider;
  log?: (msg: string) => void;
}

export interface AgentResult {
  steps: string[];
  params: StepParams;
  done: boolean;
  reason: string;
}

interface PlannedStep {
  step: string;
  params?: Record<string, string>;
}

interface SavedPlan {
  goal: string;
  url: string;
  steps: PlannedStep[];
  done: boolean;
  savedAt: string;
}

const cacheDir = () => process.env.PWAI_CACHE_DIR || '.pwai-cache';
const planDir = () => join(cacheDir(), 'plans');
const normUrl = (url: string) => url.replace(/\/+$/, '');

function planFile(goal: string, url: string): string {
  const hash = createHash('sha256').update(`${goal}\n${normUrl(url)}`).digest('hex').slice(0, 16);
  const slug = goal.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
  return join(planDir(), `${slug}.${hash}.json`);
}

function loadPlan(goal: string, url: string): SavedPlan | undefined {
  const file = planFile(goal, url);
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as SavedPlan;
  } catch {
    return undefined;
  }
}

function savePlan(goal: string, url: string, steps: PlannedStep[], done: boolean): void {
  mkdirSync(planDir(), { recursive: true });
  writeFileSync(
    planFile(goal, url),
    JSON.stringify({ goal, url: normUrl(url), steps, done, savedAt: new Date().toISOString() }, null, 2) + '\n',
    'utf8',
  );
}

/** Whether a completed plan already exists for this goal+url. */
export function hasCompletedPlan(goal: string, url: string): boolean {
  return loadPlan(goal, url)?.done === true;
}

/**
 * Autonomous test-writer loop, cache-first at EVERY level:
 *
 * - Plan cache: a run saves its step sequence to .pwai-cache/plans/.
 *   Re-running the same goal+url replays the plan with ZERO planner LLM
 *   calls. A partial plan resumes where it left off.
 * - Step cache: each step runs through the same ai() engine as the tests,
 *   so step code replays from .pwai-cache without codegen LLM calls.
 * - Step reuse: when planning IS needed, the planner is shown the wording
 *   of already-cached steps and told to reuse it verbatim, so even brand-new
 *   goals avoid codegen calls for actions the cache has seen before.
 */
export async function runAgent(page: Page, options: AgentOptions): Promise<AgentResult> {
  let llm: LlmProvider | undefined = options.llm;
  const getLlm = () => (llm ??= resolveProvider());
  const log = options.log ?? ((m: string) => console.log(`[agent] ${m}`));
  const maxSteps = options.maxSteps ?? 15;
  const maxFailures = options.maxConsecutiveFailures ?? 3;
  // Planner prompts are large (page HTML); allow generous time on local LLMs
  const timeout = options.timeout ?? (Number(process.env.PWAI_TIMEOUT) || 300_000);

  const history: string[] = [];
  const planned: PlannedStep[] = [];
  const params: StepParams = {};
  let lastError: string | undefined;
  let failures = 0;

  // ---- Phase 1: replay saved plan (no planner calls) ----
  const saved = options.replan ? undefined : loadPlan(options.goal, options.url);
  if (saved?.steps.length) {
    log(`replaying saved plan (${saved.steps.length} step(s), ${saved.done ? 'complete' : 'partial'})`);
    let planBroken = false;
    for (const ps of saved.steps) {
      try {
        await runAiSteps(page, ps.step, { ...params, ...ps.params }, { llm: options.llm });
        history.push(ps.step);
        planned.push(ps);
        Object.assign(params, ps.params);
      } catch (err) {
        lastError = err instanceof Error ? err.message.split('\n')[0] : String(err);
        log(`saved plan step failed (${lastError}) — switching to live planning`);
        planBroken = true;
        break;
      }
    }
    if (!planBroken && saved.done) {
      log('done: replayed saved plan');
      return { steps: history, params, done: true, reason: 'replayed saved plan' };
    }
  }

  // ---- Phase 2: live planning loop ----
  const finish = (done: boolean, reason: string): AgentResult => {
    savePlan(options.goal, options.url, planned, done);
    return { steps: history, params, done, reason };
  };

  // Tell the planner which step wordings are already cached (reuse = no codegen)
  const knownSteps = new StepCache(cacheDir()).list().map((e) => e.step).slice(0, 40);

  for (let i = history.length; i < maxSteps; i++) {
    const html = await captureHtml(page);
    const prompt = buildPlannerPrompt(options.goal, page.url(), html, history, lastError, knownSteps);

    let decision;
    try {
      decision = parseDecision(await getLlm().generate(prompt, { timeoutMs: timeout }));
    } catch (err) {
      failures++;
      lastError = err instanceof Error ? err.message.split('\n')[0] : String(err);
      log(`planner failed (${failures}/${maxFailures}): ${lastError}`);
      if (failures >= maxFailures) {
        // Partial plan is saved so the next run resumes from here
        return finish(false, `planner failed ${failures} time(s): ${lastError}`);
      }
      continue;
    }

    if (decision.action === 'done') {
      log(`done: ${decision.reason ?? 'goal achieved'}`);
      return finish(true, decision.reason ?? 'goal achieved');
    }
    if (decision.action === 'abort') {
      log(`abort: ${decision.reason ?? 'no reason given'}`);
      return finish(false, decision.reason ?? 'aborted');
    }

    const step = decision.step!;
    const stepParams = { ...params, ...decision.params };
    log(`step ${history.length + 1}: ${step}`);

    try {
      // Same engine as tests: cache-first, generates + caches on miss
      await runAiSteps(page, step, stepParams, { llm: options.llm });
      history.push(step);
      planned.push({ step, params: decision.params });
      Object.assign(params, decision.params);
      lastError = undefined;
      failures = 0;
    } catch (err) {
      failures++;
      lastError = err instanceof Error ? err.message.split('\n')[0] : String(err);
      log(`step failed (${failures}/${maxFailures}): ${lastError}`);
      if (failures >= maxFailures) {
        return finish(false, `gave up after ${failures} consecutive failures: ${lastError}`);
      }
    }
  }

  return finish(false, `reached maxSteps (${maxSteps})`);
}

/** Render an agent run as a permanent spec file (Workflow 2 style). */
export function renderSpec(result: AgentResult, goal: string, url: string): string {
  const stepsSrc = result.steps.map((s) => `        ${JSON.stringify(s)},`).join('\n');
  const hasParams = Object.keys(result.params).length > 0;
  const paramsSrc = hasParams ? `\n      ${JSON.stringify(result.params)},` : '';
  return `import { test } from '../src/fixtures';

// Generated by the playwright-ai agent — goal: ${goal.replace(/\n/g, ' ')}
// Steps are cached in .pwai-cache; they replay without an LLM and self-heal on UI changes.
test(${JSON.stringify(goal)}, async ({ page, ai }) => {
  await page.goto(${JSON.stringify(url)});
  await ai(
    [
${stepsSrc}
    ],${paramsSrc}
  );
});
`;
}

export function writeSpec(filePath: string, result: AgentResult, goal: string, url: string): void {
  writeFileSync(filePath, renderSpec(result, goal, url), 'utf8');
}
