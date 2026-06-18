# playwright-ai

Playwright port of [cy-ai](https://github.com/ai-action/cy-ai) implementing the
[cy.prompt() Workflow 2: Continuous AI-powered testing](https://docs.cypress.io/api/commands/prompt#Workflow-2-Continuous-AI-powered-testing).

Write E2E test steps in plain English. An LLM turns them into Playwright code on first run, the code is cached, and later runs replay the cache instantly. When the app's UI changes and a cached step fails, the step **self-heals**: it is regenerated against the live page and the cache is updated.

```ts
import { test } from '../src/fixtures';

test('logs in', async ({ page, ai }) => {
  await page.goto('https://www.saucedemo.com');
  await ai([
    'type "{{username}}" into the username field',
    'type "{{password}}" into the password field',
    'click the login button',
    'verify the page shows the "Products" title',
  ], { username: 'standard_user', password: 'secret_sauce' });
});
```

## How it works (Workflow 2)

1. **Interpret** — each natural-language step is sent to the LLM with a trimmed snapshot of the current page HTML.
2. **Generate** — the LLM returns Playwright code (`page` + `expect`), which is executed immediately.
3. **Cache** — generated code is written to `.pwai-cache/` keyed by the step text. Commit this folder so CI and teammates replay steps without an LLM.
4. **Self-heal** — if code throws (cached or fresh), the step is regenerated against the current page, with the failed code and error message fed back to the LLM, up to `healAttempts` times. The cache entry is replaced with the working code.

Placeholders like `{{username}}` keep the cache valid when dynamic values change — the cache key is the raw step text, values are passed at runtime via `params`.

## Setup

```bash
npm install
npx playwright install chromium
```

### Choose an LLM provider

Full documentation (switching, per-call override, writing your own provider): [docs/providers.md](docs/providers.md)

Copy `.env.example` to `.env` (or set env vars). Default is llama.cpp:

| Provider | Env | Default model |
|---|---|---|
| `llamacpp` (default) | `LLAMACPP_BASE_URL` (default `http://localhost:8080`), `LLAMACPP_API_KEY` if `--api-key` | whatever llama-server loaded |
| `claude-cli` | none — uses your claude.ai subscription via the Claude Code CLI (`npm i -g @anthropic-ai/claude-code`, run `claude` once to log in) | `sonnet` |
| `ollama` | `OLLAMA_BASE_URL` (default `http://localhost:11434`) | `qwen2.5-coder` |
| `anthropic` | `ANTHROPIC_API_KEY` | `claude-sonnet-4-6` |
| `openai` | `OPENAI_API_KEY` | `gpt-4o-mini` |

```bash
# llama.cpp (local, free) — uses llama-server's OpenAI-compatible API
llama-server -m qwen2.5-coder-7b-instruct-q4_k_m.gguf -c 16384 --port 8080

# or Ollama
set PWAI_PROVIDER=ollama      # PowerShell: $env:PWAI_PROVIDER='ollama'

# or hosted
set PWAI_PROVIDER=anthropic
set ANTHROPIC_API_KEY=sk-ant-...
```

Tip: use a large context (`-c 16384`) so the page HTML snapshot fits, and a coder-tuned instruct model (e.g. Qwen2.5-Coder) for best generated steps.

Override the model with `PWAI_MODEL`.

## Run

```bash
npm test                # uses cache when present, AI otherwise
npm run test:regenerate # force-regenerate every step (like cy.ai regenerate: true)
npm run cache:clear     # delete the step cache
```

First (uncached) runs call the LLM per step, so they are slow; cached runs are plain Playwright speed.

## API

`ai(steps, params?, options?)` — runs one step (string) or an array of steps in order. Returns `StepResult[]` with the generated code and whether each step ran via `cache`, `ai`, or `self-healed`.

Options (per call, or globally via `aiConfig`):

| Option | Default | cy-ai equivalent |
|---|---|---|
| `llm` | env-resolved provider | `llm` |
| `log` | `true` (`PWAI_LOG=0` to disable) | `log` |
| `regenerate` | `false` (`PWAI_REGENERATE=1`) | `regenerate` |
| `selfHeal` | `true` | cy.prompt self-healing |
| `healAttempts` | `2` | extra AI retries per step; failed code + error are fed back to the LLM |
| `timeout` | 120000 ms | `timeout` |
| `cacheDir` | `.pwai-cache` | — |

Custom provider:

```ts
import { aiConfig, OllamaProvider } from '../src/fixtures';
aiConfig({ llm: new OllamaProvider('codellama') });
```

## Continuous testing in CI

Commit `.pwai-cache/`. CI then needs **no LLM at all** for passing steps — only a UI change triggers self-healing, which requires provider credentials. To forbid AI calls in CI entirely, set `selfHeal: false` via `aiConfig` and let the failure surface for a local regeneration.

To avoid excessive self-healing (each heal is an LLM call), prefer steps phrased around stable, user-facing behavior ("click the login button") over markup details, and use placeholders for any value that varies between runs.

## Autonomous test-writer agent

Full documentation: [docs/agent.md](docs/agent.md)

The agent explores a page with the LLM, executes steps through the same `ai()` engine (so everything is cached as it goes), and writes a permanent spec when the goal is verified:

```bash
npm run agent -- --url https://www.saucedemo.com --goal "log in and add the backpack to the cart" --headed
```

Flags: `--name <slug>` (spec filename), `--max-steps <n>` (default 15), `--headed`, `--replan` (ignore the saved plan). Output lands in `tests/<name>.spec.ts` with its step code already in `.pwai-cache`, so the new spec replays instantly.

The agent is cache-first at two levels: step code comes from `.pwai-cache` like in tests, and the plan itself is saved to `.pwai-cache/plans/` per goal+url — re-running the same goal replays the plan with zero LLM calls (a partial plan resumes where it stopped). Only the FIRST run of a new goal is slow, because each planning decision is one LLM call with the page snapshot; on local llama.cpp expect roughly 30–90 s per step. Smaller/faster model quants or `PWAI_PROVIDER=claude-cli` speed this up.

There is also a Claude Code subagent at `.claude/agents/test-writer.md` — in Claude Code, ask it to "add a test for X" and it follows this repo's step/placeholder/cache conventions (see CLAUDE.md).

## Project layout

```
src/
  ai.ts               core engine: cache → execute → self-heal
  fixtures.ts         Playwright test extension exposing ai()
  cache.ts            file cache (.pwai-cache/*.json)
  executor.ts         runs generated code; HTML snapshotting
  prompt-template.ts  LLM prompt + code extraction
  providers/          llamacpp | ollama | anthropic | openai (pluggable)
agent/
  run-agent.ts        CLI (npm run agent)
  agent.ts            plan → execute → cache loop + spec writer
  planner.ts          planner prompt + JSON decision parsing
tests/
  example.spec.ts     cy-ai's example.com demo
  saucedemo.spec.ts   continuous-testing flows with placeholders
.claude/agents/
  test-writer.md      Claude Code subagent for this repo
```
