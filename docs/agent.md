# Autonomous test-writer agent

The agent turns a natural-language goal into a permanent Playwright spec. It explores the page, decides steps with an LLM, executes them through the same `ai()` engine the tests use, and writes the result to `tests/`. Everything it learns is cached, so work is never paid for twice.

## Usage

```bash
npm run agent -- --url <url> --goal "<goal>" [flags]
```

Example:

```bash
npm run agent -- --url https://www.saucedemo.com --goal "log in" --headed
```

| Flag | Meaning |
|---|---|
| `--url <url>` | Start page. Required. The agent navigates here first; steps never navigate. |
| `--goal "<text>"` | What the finished test should achieve. Required. Phrase it like a test title; it becomes the spec's test name and filename. |
| `--name <slug>` | Spec filename (`tests/<slug>.spec.ts`). Default: slugified goal, e.g. `log in` → `tests/log-in.spec.ts`. |
| `--max-steps <n>` | Max planner iterations. Default 15. |
| `--headed` | Show the browser while the agent works (and when re-running an existing spec). |
| `--replan` | Ignore the existing spec and saved plan; plan from scratch. |

## What happens when you run it

The agent checks what it already knows, in order, and only falls back to the LLM for genuinely new work:

1. **Spec exists?** If `tests/<name>.spec.ts` is already there (and `--replan` is not passed), the agent doesn't plan at all — it runs that spec with Playwright straight from cache:

   ```text
   Goal already covered by tests\log-in.spec.ts — running it from cache (no planning needed).
   Use --replan to regenerate it instead.
   ```

2. **Saved plan exists?** Plans are stored per goal+URL in `.pwai-cache/plans/`. A complete plan replays its steps with zero planner LLM calls. A partial plan (from an interrupted run) resumes where it stopped. Trailing slashes in the URL don't matter.

3. **Step code cached?** Every step runs through the same engine as `npm test`: if the step text is in `.pwai-cache/`, its code replays instantly. The log shows `(via cache)` vs `(via AI)`.

4. **Live planning** (only for new goals): the LLM sees the goal, the page HTML, completed steps, and the wording of every already-cached step — and is told to reuse cached wordings verbatim, so even new goals avoid codegen for known actions. Each successful step is cached immediately; each failed step's error is fed back to the planner for a different approach (up to 3 consecutive failures).

When the goal is verified, the agent writes the spec and saves the plan. Expect the *first* run of a new goal to be slow on local llama.cpp (one LLM call per planning decision, roughly 30–90 s each on an iGPU); every run after that is cache speed.

## Outputs

| Artifact | Where | Commit? |
|---|---|---|
| Spec file | `tests/<name>.spec.ts` | yes |
| Step code cache | `.pwai-cache/*.json` | yes — CI replays without an LLM |
| Plan cache | `.pwai-cache/plans/*.json` | yes |

The generated spec is a normal Workflow-2 test — run it with `npx playwright test tests/<name>.spec.ts`, and it self-heals via the LLM if the UI changes later.

## Choosing the LLM

The agent uses the same provider selection as the tests (`PWAI_PROVIDER`): `llamacpp` (default, needs `llama-server` running), `claude-cli` (your claude.ai subscription, no API key), `ollama`, `anthropic`, `openai`. See [providers.md](providers.md) for switching, per-call overrides, and writing your own provider.

No LLM available? Ask Cowork (or the Claude Code `test-writer` subagent) to generate the spec and seed the cache instead — the agent CLI and `npm test` will then run it from cache with no local inference at all.

## Troubleshooting

- **"Goal already covered by ... — running it from cache"** — not an error; that's check 1 working. Use `--replan` (or a different `--name`) if you really want to regenerate.
- **`Cannot reach llama.cpp ... Is llama-server running?`** (or `fetch failed`) — the LLM server isn't up or `LLAMACPP_BASE_URL` is wrong. Start `llama-server` (see providers.md), or switch provider with `PWAI_PROVIDER`. The agent retries 3× then stops without writing a spec.
- **`TimeoutError: The operation was aborted due to timeout`** — the LLM didn't answer within the limit (common on CPU/iGPU llama.cpp with large pages). The planner now retries up to 3 times and saves a partial plan, so re-running the same command resumes where it stopped. Raise the limit with `PWAI_TIMEOUT` (ms), e.g. `$env:PWAI_TIMEOUT='600000'`, or switch to a faster provider/model.
- **Agent is sluggish** — it's live-planning a new goal. Check the log: `(via cache)` steps are free; `generating with ...` lines are LLM calls. Reuse goals/wordings, or switch to `claude-cli` / a smaller model.
- **"can't find best locator" / step times out finding an element** — the model picked a brittle selector.