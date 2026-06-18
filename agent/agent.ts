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
  /**
   * Credentials injected at runtime (from .env). These ALWAYS override any
   * username/password the planner proposes, and are never written to the
   * saved plan, so secrets stay in .env.
   */
  credentials?: { username?: string; password?: string };
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
const normStep = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** Remove username/password so secrets never get written to a saved plan. */
function stripCreds(params?: Record<string, string>): Record<string, string> | undefined {
  if (!params) return params;
  const out = Object.fromEntries(
    Object.entries(params).filter(([k]) => k !== 'username' && k !== 'password'),
  );
  return Object.keys(out).length ? out : undefined;
}

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
  // Never persist credentials in the plan.
  const safe = steps.map((s) => ({ step: s.step, params: stripCreds(s.params) }));
  writeFileSync(
    planFile(goal, url),
    JSON.stringify({ goal, url: normUrl(url), steps: safe, done, savedAt: new Date().toISOString() }, null, 2) + '\n',
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
 *   Re-running the same goal+url replays the plan with ZERO planner LLM calls.
 * - Step cache: each step runs through the same ai() engine as the tests.
 * - Step reuse: the planner is shown already-cached step wordings to reuse.
 * - De-dup / anti-loop: a step already run is never executed twice.
 * - Credentials: username/password always come from options.credentials (.env),
 *   overriding whatever the planner proposes, and are never saved to the plan.
 */
export async function runAgent(page: Page, options: AgentOptions): Promise<AgentResult> {
  let llm: LlmProvider | undefined = options.llm;
  const getLlm = () => (llm ??= resolveProvider());
  const log = options.log ?? ((m: string) => console.log(`[agent] ${m}`));
  const maxSteps = options.maxSteps ?? 15;
  const maxFailures = options.maxConsecutiveFailures ?? 3;
  const timeout = options.timeout ?? (Number(process.env.PWAI_TIMEOUT) || 300_000);

  // .env credentials override any username/password the planner emits.
  const credOverlay: Record<string, string> = {};
  if (options.credentials?.username !== undefined) credOverlay.username = options.credentials.username;
  if (options.credentials?.password !== undefined) credOverlay.password = options.credentials.password;
  const withCreds = (p: StepParams): StepParams => ({ ...p, ...credOverlay });

  const history: string[] = [];
  const planned: PlannedStep[] = [];
  const params: StepParams = {};
  const seen = new Set<string>();
  let lastError: string | undefined;
  let failures = 0;
  let repeats = 0;

  // ---- Phase 1: replay saved plan (no planner calls) ----
  const saved = options.replan ? undefined : loadPlan(options.goal, options.url);
  if (saved?.steps.length) {
    log(`replaying saved plan (${saved.steps.length} step(s), ${saved.done ? 'complete' : 'partial'})`);
    let planBroken = false;
    for (const ps of saved.steps) {
      if (seen.has(normStep(ps.step))) continue;
      try {
        await runAiSteps(page, ps.step, withCreds({ ...params, ...ps.params }), { llm: options.llm });
        history.push(ps.step);
        planned.push(ps);
        seen.add(normStep(ps.step));
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

    if (seen.has(normStep(step))) {
      repeats++;
      log(`duplicate step ignored (${repeats}): ${step}`);
      if (repeats >= 2) {
        log('done: planner kept repeating steps — assuming goal complete');
        return finish(true, 'completed (planner stopped proposing new steps)');
      }
      lastError = `You already performed this step: "${step}". Do NOT repeat it. Propose a DIFFERENT next action, or return {"action":"done"} if the goal is achieved.`;
      continue;
    }

    log(`step ${history.length + 1}: ${step}`);

    try {
      // .env credentials override the planner's username/password here.
      await runAiSteps(page, step, withCreds({ ...params, ...decision.params }), { llm: options.llm });
      history.push(step);
      planned.push({ step, params: decision.params });
      seen.add(normStep(step));
      Object.assign(params, decision.params);
      lastError = undefined;
      failures = 0;
      repeats = 0;
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

/**
 * Render an agent run as a permanent spec file (Workflow 2 style).
 * The URL comes from BASE_URL in .env, and username/password come from
 * CREDENTIALS in .env — generated specs never hardcode them.
 */
export function renderSpec(result: AgentResult, goal: string, _url: string): string {
  const seen = new Set<string>();
  const uniqueSteps = result.steps.filter((s) => {
    const key = s.trim().toLowerCase().replace(/\s+/g, ' ');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const stepsSrc = uniqueSteps.map((s) => `        ${JSON.stringify(s)},`).join('\n');

  const usesCreds = 'username' in result.params || 'password' in result.params;
  const extra = Object.fromEntries(
    Object.entries(result.params).filter(([k]) => k !== 'username' && k !== 'password'),
  );
  const hasExtra = Object.keys(extra).length > 0;

  const imports = usesCreds
    ? `import { BASE_URL, CREDENTIALS } from '../src/test-config';`
    : `import { BASE_URL } from '../src/test-config';`;

  let paramsSrc = '';
  if (usesCreds && hasExtra) {
    paramsSrc = `\n      { ...CREDENTIALS, ${Object.entries(extra)
      .map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`)
      .join(', ')} },`;
  } else if (usesCreds) {
    paramsSrc = `\n      CREDENTIALS,`;
  } else if (hasExtra) {
    paramsSrc = `\n      ${JSON.stringify(extra)},`;
  }

  return `import { test } from '../src/fixtures';
${imports}

// Generated by the playwright-ai agent — goal: ${goal.replace(/\n/g, ' ')}
// URL + credentials come from .env (see .env.example).
// Steps are cached in .pwai-cache; they replay without an LLM and self-heal on UI changes.
test(${JSON.stringify(goal)}, async ({ page, ai }) => {
  await page.goto(BASE_URL);
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
