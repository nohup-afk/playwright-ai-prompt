/** One decision from the planner LLM. */
export interface PlannerDecision {
  action: 'step' | 'done' | 'abort';
  /** Natural-language test step (when action = "step"). */
  step?: string;
  /** Placeholder values used by the step, e.g. { username: "standard_user" }. */
  params?: Record<string, string>;
  reason?: string;
}

export function buildPlannerPrompt(
  goal: string,
  url: string,
  html: string,
  history: string[],
  lastError?: string,
  knownSteps: string[] = [],
): string {
  const historyNote = history.length
    ? `Steps already completed successfully:\n${history.map((s, i) => `${i + 1}. ${s}`).join('\n')}`
    : 'No steps completed yet.';

  const errorNote = lastError
    ? `\nThe previous step you proposed FAILED with: ${lastError}\nPropose a different or corrected step.`
    : '';

  const knownNote = knownSteps.length
    ? `\nSteps that already exist in the cache. If one of these matches the action you need, reuse its wording EXACTLY (cached steps run instantly without AI):\n${knownSteps
        .map((s) => `- ${s}`)
        .join('\n')}\n`
    : '';

  return `You are an E2E test planner. You control a Playwright browser through
natural-language test steps. Decide the SINGLE next step toward the goal,
or finish.

Goal: ${goal}

${historyNote}
${errorNote}${knownNote}
Current URL: ${url}

Current page HTML:
\`\`\`html
${html}
\`\`\`

Rules:
1. Respond with ONLY a JSON object, no other text.
2. To act: {"action":"step","step":"<short imperative step>","params":{...}}
   - Steps are user actions or verifications: "click the login button",
     'verify the cart badge shows 1'. No CSS selectors or code.
   - Put data values in {{placeholders}} inside the step text and supply
     them in "params": {"action":"step","step":"type \\"{{username}}\\" into the username field","params":{"username":"standard_user"}}
   - One action per step. The goal should end with at least one "verify" step.
3. When the goal is fully achieved AND verified: {"action":"done","reason":"..."}
4. If the goal is impossible on this page: {"action":"abort","reason":"..."}
`;
}

/** Parse the planner's JSON decision (tolerates code fences and prose). */
export function parseDecision(completion: string): PlannerDecision {
  const fenced = completion.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : completion;
  const jsonMatch = candidate.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`Planner returned no JSON: ${completion.slice(0, 200)}`);
  const parsed = JSON.parse(jsonMatch[0]) as PlannerDecision;
  if (!['step', 'done', 'abort'].includes(parsed.action)) {
    throw new Error(`Planner returned invalid action: ${parsed.action}`);
  }
  if (parsed.action === 'step' && !parsed.step) {
    throw new Error('Planner action "step" missing step text');
  }
  return parsed;
}
