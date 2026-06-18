import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CachedStep } from './types';

/**
 * File-based step cache — the Playwright equivalent of cy.prompt's
 * "interpret once, cache, reuse across machines/CI" behavior.
 *
 * Key = sha256 of the *raw* step text (with {{placeholders}} intact),
 * so changing placeholder values never invalidates the cache —
 * only editing the step text does.
 */
export class StepCache {
  constructor(private readonly dir: string) {}

  static keyFor(step: string): string {
    return createHash('sha256').update(step.trim()).digest('hex').slice(0, 16);
  }

  private fileFor(step: string): string {
    const slug = step
      .toLowerCase()
      .replace(/\{\{(\w+)\}\}/g, '$1')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60);
    return join(this.dir, `${slug}.${StepCache.keyFor(step)}.json`);
  }

  get(step: string): CachedStep | undefined {
    const file = this.fileFor(step);
    if (!existsSync(file)) return undefined;
    try {
      return JSON.parse(readFileSync(file, 'utf8')) as CachedStep;
    } catch {
      return undefined;
    }
  }

  set(entry: CachedStep): void {
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(this.fileFor(entry.step), JSON.stringify(entry, null, 2) + '\n', 'utf8');
  }

  /** All cached steps (used by the agent planner to encourage reuse). */
  list(): CachedStep[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        try {
          return JSON.parse(readFileSync(join(this.dir, f), 'utf8')) as CachedStep;
        } catch {
          return undefined;
        }
      })
      .filter((e): e is CachedStep => !!e && typeof e.step === 'string');
  }
}
