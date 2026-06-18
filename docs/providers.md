# Using a different LLM provider / agent

Everything in this framework — `npm test`, self-healing, and `npm run agent` — uses one pluggable LLM provider, selected by the `PWAI_PROVIDER` environment variable. This doc shows how to switch, configure, or add one, and when to use which "agent" front-end.

## Switching providers

Set `PWAI_PROVIDER` (in `.env`, or per command) to one of:

| Value | Needs | Default model | Notes |
|---|---|---|---|
| `llamacpp` *(default)* | `llama-server` running | whatever the server loaded | Local and free. `LLAMACPP_BASE_URL` (default `http://localhost:8080`), `LLAMACPP_API_KEY` only if started with `--api-key`. |
| `claude-cli` | Claude Code CLI + claude.ai login | `sonnet` | **No API key.** `npm i -g @anthropic-ai/claude-code`, run `claude` once to log in. `CLAUDE_CLI_PATH` if not on PATH. Accepts `claude`, `claude-cli`, `claude_cli`. |
| `ollama` | `ollama serve` + pulled model | `qwen2.5-coder` | `OLLAMA_BASE_URL` (default `http://localhost:11434`). |
| `anthropic` | `ANTHROPIC_API_KEY` | `claude-sonnet-4-6` | Hosted API, pay per call. |
| `openai` | `OPENAI_API_KEY` | `gpt-4o-mini` | Hosted API, pay per call. |

Override the model with `PWAI_MODEL` (e.g. `PWAI_MODEL=opus` for claude-cli, `PWAI_MODEL=qwen2.5-coder:3b` for ollama).

PowerShell examples:

```powershell
# llama.cpp (default — just start the server)
llama-server -hf Qwen/Qwen2.5-Coder-7B-Instruct-GGUF:Q4_K_M -c 16384 --port 8080
npm test

# Claude via your subscription (no API key)
$env:PWAI_PROVIDER='claude-cli'
npm run agent -- --url https://www.saucedemo.com --goal "log in" --headed

# Hosted Anthropic API
$env:PWAI_PROVIDER='anthropic'; $env:ANTHROPIC_API_KEY='sk-ant-...'
npm test

# One-off: different model for this run only
$env:PWAI_MODEL='haiku'; $env:PWAI_PROVIDER='claude-cli'; npm run test:regenerate
```

cmd.exe uses `set NAME=value` instead of `$env:NAME='value'`.

Remember: the LLM is only used for uncached steps, self-healing, and new agent goals. Cached runs are provider-independent — you can generate with one provider and replay with none.

## Per-call provider (in code)

Pass a provider instance to a single `ai()` call or set it globally — this overrides `PWAI_PROVIDER`:

```ts
import { test, aiConfig, ClaudeCliProvider, LlamaCppProvider } from '../src/fixtures';

// Globally (e.g. at the top of a spec): heal with Claude even if env says llamacpp
aiConfig({ llm: new ClaudeCliProvider('sonnet') });

// Or per call
test('example', async ({ page, ai }) => {
  await page.goto('https://example.com');
  await ai('see heading "Example Domain"', {}, { llm: new LlamaCppProvider() });
});
```

A practical mix: generate locally for free, but pin CI healing to a stronger model — or set `selfHeal: false` in CI so no provider is ever needed there.

## Adding your own provider

A provider is ~30 lines. Implement `LlmProvider` (`src/types.ts`): a `name`, a `model`, and `generate(prompt) -> completion text`.

1. Create `src/providers/my-provider.ts`:

```ts
import type { LlmProvider } from '../types';

export class MyProvider implements LlmProvider {
  readonly name = 'my-provider';
  readonly model = process.env.PWAI_MODEL || 'some-model';

  async generate(prompt: string, options?: { timeoutMs?: number }): Promise<string> {
    const res = await fetch('http://my-llm-endpoint/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, messages: [{ role: 'user', content: prompt }] }),
      signal: AbortSignal.timeout(options?.timeoutMs ?? 120_000),
    });
    if (!res.ok) throw new Error(`my-provider failed (${res.status}): ${await res.text()}`);
    const data = await res.json();
    return data.choices[0].message.content;
  }
}
```

2. Register it in `src/providers/index.ts` (export it and add a branch in `resolveProvider()`).
3. Use it: `PWAI_PROVIDER=my-provider`, or `aiConfig({ llm: new MyProvider() })`.

The completion may be raw code or a fenced ```js block — `extractCode()` handles both. Any OpenAI-compatible endpoint (LM Studio, vLLM, llamafile, OpenRouter...) can also just reuse `LlamaCppProvider` with a different `LLAMACPP_BASE_URL`.

## Which agent front-end to use

| Front-end | When | LLM needed on your machine? |
|---|---|---|
| **Cowork (chat)** | Creating new tests, fixing steps, seeding cache — just describe the flow | No — Cowork generates spec + cache directly |
| **Claude Code subagent** (`.claude/agents/test-writer.md`) | Working inside Claude Code on this repo; it follows the step/placeholder/cache conventions | No (uses your claude.ai login) |
| **CLI agent** (`npm run agent`) | Scripted/CI/offline autonomous generation | Yes — any provider above |
| **`npm test`** | Running existing specs | Only for new/healing steps |

See [agent.md](agent.md) for the CLI agent's flags and cache behavior.
