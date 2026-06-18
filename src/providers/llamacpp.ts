import type { LlmProvider } from '../types';

/**
 * llama.cpp provider — uses llama-server's OpenAI-compatible API.
 *
 * Start the server first, e.g.:
 *   llama-server -m qwen2.5-coder-7b-instruct-q4_k_m.gguf -c 16384 --port 8080
 *
 * The model is whatever the server has loaded; the `model` field is
 * informational unless you run llama-server with multiple models.
 */
export class LlamaCppProvider implements LlmProvider {
  readonly name = 'llamacpp';
  readonly model: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(model = process.env.PWAI_MODEL || 'default', baseUrl?: string) {
    this.model = model;
    this.baseUrl = (baseUrl || process.env.LLAMACPP_BASE_URL || 'http://localhost:8080').replace(/\/$/, '');
    // Only needed if llama-server was started with --api-key
    this.apiKey = process.env.LLAMACPP_API_KEY || '';
  }

  async generate(prompt: string, options?: { timeoutMs?: number }): Promise<string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

    const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: this.model,
        temperature: 0,
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(options?.timeoutMs ?? 120_000),
    });
    if (!res.ok) {
      throw new Error(`llama.cpp request failed (${res.status}): ${await res.text()}`);
    }
    const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
    return data.choices[0]?.message?.content ?? '';
  }
}
