import type { LlmProvider } from '../types';

/**
 * Ollama provider (default — same as cy-ai).
 * Requires `ollama serve` and `ollama pull qwen2.5-coder`.
 */
export class OllamaProvider implements LlmProvider {
  readonly name = 'ollama';
  readonly model: string;
  private readonly baseUrl: string;

  constructor(model = process.env.PWAI_MODEL || 'qwen2.5-coder', baseUrl?: string) {
    this.model = model;
    this.baseUrl = (baseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/$/, '');
  }

  async generate(prompt: string, options?: { timeoutMs?: number }): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt,
        stream: false,
        options: { num_ctx: 16384, temperature: 0 },
      }),
      signal: AbortSignal.timeout(options?.timeoutMs ?? 120_000),
    });
    if (!res.ok) {
      throw new Error(`Ollama request failed (${res.status}): ${await res.text()}`);
    }
    const data = (await res.json()) as { response: string };
    return data.response;
  }
}
