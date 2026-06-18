/**
 * CLI for the autonomous test-writer agent.
 *
 *   npm run agent -- --goal "log in and add the backpack to the cart"
 *
 * If the goal already has a spec file, it RUNS that spec from cache instead
 * of planning again. Use --replan to force regeneration.
 *
 * Flags:
 *   --url <url>        start page (optional; defaults to BASE_URL in .env)
 *   --goal "<text>"    what the test should achieve (required)
 *   --name <slug>      spec filename (default: derived from goal)
 *   --max-steps <n>    planner iterations (default 15)
 *   --headed           show the browser
 *   --replan           ignore saved plan/spec and re-plan from scratch
 */
import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { runAgent, writeSpec } from './agent';
import { BASE_URL } from '../src/test-config';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function runExistingSpec(specPath: string): never {
  console.log(`Goal already covered by ${specPath} — running it from cache (no planning needed).`);
  console.log('Use --replan to regenerate it instead.\n');
  const args = ['playwright', 'test', specPath];
  if (process.argv.includes('--headed')) args.push('--headed');
  const r = spawnSync('npx', args, { stdio: 'inherit', shell: process.platform === 'win32' });
  process.exit(r.status ?? 0);
}

async function main() {
  // --url is optional; defaults to BASE_URL from .env
  const url = arg('url') || BASE_URL;
  const goal = arg('goal');
  if (!goal) {
    console.error('Usage: npm run agent -- --goal "<goal>" [--url <url>] [--name <slug>] [--max-steps <n>] [--headed] [--replan]');
    console.error('(--url defaults to BASE_URL in .env)');
    process.exit(1);
  }

  const replan = process.argv.includes('--replan');
  const name =
    arg('name') ||
    goal.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
  const specPath = join('tests', `${name}.spec.ts`);

  // Already have a spec for this goal? Just run it.
  if (existsSync(specPath) && !replan) runExistingSpec(specPath);

  const browser = await chromium.launch({ headless: !process.argv.includes('--headed') });
  const page = await browser.newPage();
  try {
    await page.goto(url);
    const result = await runAgent(page, {
      goal,
      url,
      maxSteps: Number(arg('max-steps') ?? 15),
      replan,
    });

    if (result.steps.length === 0) {
      console.error(`No steps succeeded: ${result.reason}`);
      process.exit(1);
    }

    writeSpec(specPath, result, goal, url);
    console.log(`\n${result.done ? 'Goal verified.' : `Stopped early: ${result.reason}`}`);
    console.log(`Wrote ${specPath} with ${result.steps.length} step(s).`);
    console.log('Step code is already cached in .pwai-cache — run it with:');
    console.log(`  npx playwright test ${specPath}`);
    if (!result.done) process.exitCode = 2;
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
