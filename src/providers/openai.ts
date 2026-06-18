import type { LlmProvider } from '../types';

/** OpenAI provider. Requires OPENAI_API_KEY. */
export class OpenAIProvider implements LlmProvider {
  readonly name = 'openai';
  readonly model: string;
  private readonly apiKey: string;

  constructor(model = process.env.PWAI_MODEL || 'gpt-4o-mini', apiKey?: string) {
    this.model = model;
    this.apiKey = apiKey || process.env.OPENAI_API_KEY || '';
    if (!this.apiKey) throw new Error('OPENAI_API_KEY is not set');
  }

  async generate(prompt: string, options?: { timeoutMs?: number }): Promise<string> {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(options?.timeoutMs ?? 120_000),
    });
    if (!res.ok) {
      throw new Error(`OpenAI request failed (${res.status}): ${await res.text()}`);
    }
    const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
    return data.choices[0]?.message?.content ?? '';
  }
}
