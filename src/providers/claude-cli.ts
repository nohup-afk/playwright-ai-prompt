import { spawn } from 'node:child_process';
import type { LlmProvider } from '../types';

/**
 * Claude Code CLI provider — no API key needed. Uses the `claude` CLI,
 * which authenticates with your claude.ai subscription login.
 *
 * Setup (once):
 *   npm install -g @anthropic-ai/claude-code
 *   claude   # then follow the login prompt
 *
 * Then: PWAI_PROVIDER=claude-cli
 */
export class ClaudeCliProvider implements LlmProvider {
  readonly name = 'claude-cli';
  readonly model: string;
  private readonly command: string;

  constructor(model = process.env.PWAI_MODEL || 'sonnet', command?: string) {
    this.model = model;
    this.command = command || process.env.CLAUDE_CLI_PATH || 'claude';
  }

  generate(prompt: string, options?: { timeoutMs?: number }): Promise<string> {
    const timeoutMs = options?.timeoutMs ?? 120_000;
    const args = ['-p', '--output-format', 'text', '--model', this.model];

    return new Promise((resolve, reject) => {
      // shell:true so Windows resolves claude.cmd from npm global installs
      const child = spawn(this.command, args, { shell: process.platform === 'win32' });
      let stdout = '';
      let stderr = '';

      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`claude CLI timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      child.stdout.on('data', (d) => (stdout += d));
      child.stderr.on('data', (d) => (stderr += d));

      child.on('error', (err) => {
        clearTimeout(timer);
        reject(
          new Error(
            `Failed to run "${this.command}". Install the Claude Code CLI first:\n` +
              `  npm install -g @anthropic-ai/claude-code\n` +
              `then run "claude" once to log in with your claude.ai account.\nCause: ${err.message}`,
          ),
        );
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(stdout);
        else reject(new Error(`claude CLI exited with code ${code}: ${stderr || stdout}`));
      });

      // Prompt via stdin (too long for argv)
      child.stdin.write(prompt);
      child.stdin.end();
    });
  }
}
