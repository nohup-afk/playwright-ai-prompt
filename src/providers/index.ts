import type { LlmProvider } from '../types';
import { OllamaProvider } from './ollama';
import { AnthropicProvider } from './anthropic';
import { OpenAIProvider } from './openai';
import { LlamaCppProvider } from './llamacpp';
import { ClaudeCliProvider } from './claude-cli';

export { OllamaProvider, AnthropicProvider, OpenAIProvider, LlamaCppProvider, ClaudeCliProvider };

/** Resolve provider from the PWAI_PROVIDER env var (llamacpp, claude-cli, ollama, anthropic, openai). */
export function resolveProvider(): LlmProvider {
  const name = (process.env.PWAI_PROVIDER || 'llamacpp').toLowerCase().replace(/[.\-_]/g, '');
  if (name === 'llamacpp') return new LlamaCppProvider();
  if (name === 'claudecli' || name === 'claude') return new ClaudeCliProvider();
  if (name === 'ollama') return new OllamaProvider();
  if (name === 'anthropic') return new AnthropicProvider();
  if (name === 'openai') return new OpenAIProvider();
  throw new Error(`Unknown PWAI_PROVIDER "${name}" (expected llamacpp, claude-cli, ollama, anthropic, or openai)`);
}
