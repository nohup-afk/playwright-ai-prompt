import type { LlmProvider } from '../types';

/** Anthropic provider. Requires ANTHROPIC_API_KEY. */
export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic';
  readonly model: string;
  private readonly apiKey: string;

  constructor(model = process.env.PWAI_MODEL || 'claude-sonnet-4-6', apiKey?: string) {
    this.model = model;
    this.apiKey = apiKey || process.env.ANTHROPIC_API_KEY || '';
    if (!this.apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
  }

  async generate(prompt: string, options?: { timeoutMs?: number }): Promise<string> {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 2048,
        temperature: 0,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(options?.timeoutMs ?? 120_000),
    });
    if (!res.ok) {
      throw new Error(`Anthropic request failed (${res.status}): ${await res.text()}`);
    }
    const data = (await res.json()) as { content: Array<{ type: string; text?: string }> };
    return data.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  }
}
