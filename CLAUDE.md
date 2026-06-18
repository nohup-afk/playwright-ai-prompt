# playwright-ai

Playwright E2E framework where test steps are written in natural language and
executed by an LLM-backed `ai()` fixture (port of cy-ai / cy.prompt Workflow 2:
continuous AI-powered testing).

## Architecture

- `src/fixtures.ts` — exports `test` (extends `@playwright/test`) with the `ai` fixture, plus `aiConfig` and all providers.
- `src/ai.ts` — core engine `runAiSteps`: cache lookup → execute cached code → on miss, generate via LLM → on failure, self-heal (regenerate with failed code + error fed back, up to `healAttempts`).
- `src/cache.ts` — `.pwai-cache/*.json`, keyed by sha256 of the raw step text. Placeholders (`{{name}}`) are part of the key; their values are not.
- `src/providers/` — `llamacpp` (default), `claude-cli`, `ollama`, `anthropic`, `openai`. Selected via `PWAI_PROVIDER`.
- `src/prompt-template.ts` — the LLM prompt; generated code is the body of an async fn with `page`, `expect`, `params` in scope. Enforces a Cypress-style selector priority (`SELECTOR_PRIORITY`): data-cy → data-test → data-testid → role/label → text → id → name; brittle class chains are forbidden.
- `src/test-config.ts` — loads `.env` (dotenv) and exports `BASE_URL` and `CREDENTIALS`; specs and the agent import these instead of hardcoding URL/credentials.
- `agent/` — autonomous test-writer agent (`npm run agent`); cache-first plus dedup/anti-loop so a goal never repeats a step.

## Conventions when writing specs

- Import from the fixture, not @playwright/test: `import { test } from '../src/fixtures'`.
- Get URL/credentials from `src/test-config` (`BASE_URL`, `CREDENTIALS`) — never hardcode them in a spec. `page.goto(BASE_URL)`.
- Navigate with `page.goto(...)` explicitly; `ai()` steps never navigate.
- Steps are short imperative phrases about user-visible behavior: `"click the login button"`, not CSS selectors.
- Dynamic values always go through placeholders: step text `'type "{{username}}" into the username field'` + params `{ username: '...' }`. Never inline values that may change — that would invalidate the cache key.
- Reuse exact step wording across tests where possible — identical text shares one cache entry.
- Do not edit `.pwai-cache/` by hand except to delete stale entries; it is generated. Commit it.

## Commands

- `npm test` — run (cache first, LLM fallback)
- `npm run test:headed` — visible browser
- `npm run test:regenerate` — ignore cache, regenerate all steps
- `npm run typecheck`
- `npm run agent -- --url <url> --goal "<goal>"` — autonomously write a new spec
- `npm run cache:clear`

## Enviro