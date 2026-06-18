/**
 * CLI for the autonomous test-writer agent.
 *
 *   npm run agent --goal="log in and add the backpack to the cart"
 *   npm run agent -- "log in and add the backpack to the cart"   (positional)
 *
 * If the goal already has a spec file, it RUNS that spec from cache instead
 * of planning again. Use --replan to force regeneration.
 *
 * Arguments:
 *   "<goal>"           what the test should achieve (positional, or --goal="<text>")
 *
 * Flags (use NAME=value form to skip the `--` separator):
 *   --url=<url>        start page (optional; defaults to BASE_URL in .env)
 *   --name=<slug>      spec filename (default: derived from goal)
 *   --max-steps=<n>    planner iterations (default 15)
 *   --headed           show the browser
 *   --replan           ignore saved plan/spec and re-plan from scratch
 */
import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { runAgent, writeSpec } from './agent';
import { BASE_URL, CREDENTIALS } from '../src/test-config';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) {
    return process.argv[i + 1];
  }
  // Also support `npm run agent --goal="..."` (npm exposes it as npm_config_goal,
  // which lets you skip the `--` separator). Values with spaces need the `=`.
  return process.env[`npm_config_${name.replace(/-/g, '_')}`];
}

/** Boolean flag from argv or npm_config_* (e.g. --headed / --replan). */
function flag(name: string): boolean {
  if (process.argv.includes(`--${name}`)) return true;
  const v = process.env[`npm_config_${name.replace(/-/g, '_')}`];
  return v === 'true' || v === '' || v === '1';
}

/**
 * First non-flag argument (and not a flag's value). Lets the goal be passed
 * positionally: `npm run agent -- "login to leadmanager"`.
 */
function positional(): string | undefined {
  const argv = process.argv.slice(2);
  const valueFlags = new Set(['--url', '--goal', '--name', '--max-steps']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      if (valueFlags.has(a)) i++; // skip this flag's value
      continue;
    }
    return a;
  }
  return undefined;
}

function runExistingSpec(specPath: string): never {
  console.log(`Goal already covered by ${specPath} — running it from cache (no planning needed).`);
  console.log('Use --replan to regenerate it instead.\n');
  const args = ['playwright', 'test', specPath];
  if (flag('headed')) args.push('--headed');
  const r = spawnSync('npx', args, { stdio: 'inherit', shell: process.platform === 'win32' });
  process.exit(r.status ?? 0);
}

async function main() {
  // --url is optional; defaults to BASE_URL from .env
  const url = arg('url') || BASE_URL;
  // Goal can be positional or --goal="<text>"
  const goal = arg('goal') || positional();
  if (!goal) {
    console.error('Usage: npm run agent --goal="<goal>" [--url="<url>"] [--name="<slug>"] [--max-steps=<n>] [--headed] [--replan]');
    console.error('   or: npm run agent -- "<goal>" [--headed] [--replan]');
    console.error('Example: npm run agent --goal="login to leadmanager"');
    console.error('(--url defaults to BASE_URL in .env)');
    process.exit(1);
  }

  const replan = flag('replan');
  const name =
    arg('name') ||
    goal.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
  const specPath = join('tests', `${name}.spec.ts`);

  // Already have a spec for this goal? Just run it.
  if (existsSync(specPath) && !replan) runExistingSpec(specPath);

  const browser = await chromium.launch({ headless: !flag('headed') });
  const page = await browser.newPage();
  try {
    await page.goto(url);
    const result = await runAgent(page, {
      goal,
      url,
      maxSteps: Number(arg('max-steps') ?? 15),
      replan,
      credentials: CREDENTIALS, // username/password from .env override the planner
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
