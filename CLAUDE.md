# playwright-ai

Playwright E2E framework where test steps are written in natural language and
executed by an LLM-backed `ai()` fixture (port of cy-ai / cy.prompt Workflow 2:
continuous AI-powered testing).

## Architecture

- `src/fixtures.ts` — exports `test` (extends `@playwright/test`) with the `ai` fixture, plus `aiConfig` and all providers.
- `src/ai.ts` — core engine `runAiSteps`: cache lookup → execute cached code → on miss, generate via LLM → on failure, self-heal (regenerate with failed code + error fed back, up to `healAttempts`).
- `src/cache.ts` — `.pwai-cache/*.json`, keyed by sha256 of the raw step text. Placeholders (`{{name}}`) are part of the key; their values are not.
- `src/providers/` — `llamacpp` (default), `claude-cli`, `ollama`, `anthropic`, `openai`. Selected via `PWAI_PROVIDER`.
- `src/prompt-template.ts` — the LLM prompt; generated code is the body of an async fn with `page`, `expect`, `params` in scope.
- `agent/` — autonomous test-writer agent (`npm run agent`).

## Conventions when writing specs

- Import from the fixture, not @playwright/test: `import { test } from '../src/fixtures'`.
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

## Environment

`PWAI_PROVIDER` (llamacpp default), `PWAI_MODEL`, `PWAI_REGENERATE=1`, `PWAI_LOG=0`,
`LLAMACPP_BASE_URL`, `CLAUDE_CLI_PATH`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`. See `.env.example`.

## Gotchas

- Changing a step's wording (even punctuation) creates a new cache key → one LLM call to regenerate.
- Generated code must never call `page.goto` (the prompt forbids it); if you see it in cache entries, the step wording probably implies navigation — reword it.
- First uncached run is slow (one LLM call per step); that's expected.
