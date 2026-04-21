import type { Tool } from './base.js';
import type { ToolDefinition, ToolResult } from '../types.js';
import { CommandGuard } from '../security/sandbox.js';
import { confirm } from '../cli/confirm.js';
import { truncateByBytes } from '../utils/truncate.js';
import { runProcess } from '../utils/process.js';
import type { ToolExecutionContext } from './base.js';
import type { Config } from '../types.js';

const DEFAULT_TIMEOUT = 120_000; // 120 seconds
const MAX_OUTPUT_BYTES = 100 * 1024; // 100KB
const MIN_TIMEOUT = 1_000;
const MAX_TIMEOUT = 300_000; // 5 minutes

export class ShellExecTool implements Tool {
  definition: ToolDefinition = {
    name: 'shell_exec',
    description:
      'Execute a shell command in the working directory. ' +
      'Commands are executed with a 120-second timeout. ' +
      'Some commands may require user confirmation for safety. ' +
      'Output is truncated if it exceeds 100KB.',
    input_schema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The shell command to execute',
        },
        timeout: {
          type: 'number',
          description: 'Timeout in milliseconds. Defaults to 120000 (120s).',
        },
      },
      required: ['command'],
    },
  };

  private commandGuard: CommandGuard;

  constructor(
    private workingDir: string,
    securityConfig: Config['security'],
    private requireConfirmation: boolean = true,
  ) {
    this.commandGuard = new CommandGuard(securityConfig);
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    return this.executeWithContext(input, { depth: 0 });
  }

  async executeWithContext(
    input: Record<string, unknown>,
    ctx: ToolExecutionContext,
  ): Promise<ToolResult> {
    const command = input['command'] as string;
    const rawTimeout = input['timeout'];
    const timeout = clampTimeout(rawTimeout, DEFAULT_TIMEOUT);

    try {
      // Security check
      const check = this.commandGuard.checkCommand(command);

      if (check === 'blocked') {
        return {
          tool_use_id: '',
          content: `Command blocked for security reasons: ${command}\nThis command matches a dangerous pattern and cannot be executed.`,
          is_error: true,
        };
      }

      if (check === 'needs_confirmation' && this.requireConfirmation) {
        if (ctx.hookManager) await ctx.hookManager.emitPermissionRequest(input);
        const approved = await confirm(`Allow command: ${command}?`);
        if (!approved) {
          return {
            tool_use_id: '',
            content: 'Command rejected by user.',
            is_error: true,
          };
        }
      }

      // Execute command
      const result = await this.runCommand(command, timeout, ctx.signal);
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        tool_use_id: '',
        content: `Error executing command: ${msg}`,
        is_error: true,
      };
    }
  }

  private runCommand(
    command: string,
    timeout: number,
    signal?: AbortSignal,
  ): Promise<ToolResult> {
    return new Promise((resolve) => {
      const env = this.commandGuard.getSanitizedEnv();
      runProcess({
        command: process.env['SHELL'] || '/bin/sh',
        args: ['-lc', command],
        cwd: this.workingDir,
        env,
        timeoutMs: timeout,
        signal,
        detached: true,
      }).then((result) => {
        let output = result.stdout;
        if (result.stderr) {
          output += (output ? '\n' : '') + `STDERR:\n${result.stderr}`;
        }
        output = truncateByBytes(output, MAX_OUTPUT_BYTES);

        if (result.aborted) {
          resolve({
            tool_use_id: '',
            content: `Command aborted by user.\n${output}`.trim(),
            is_error: true,
          });
          return;
        }

        if (result.timedOut) {
          resolve({
            tool_use_id: '',
            content: `Command timed out after ${timeout}ms.\n${output}`.trim(),
            is_error: true,
          });
          return;
        }

        if (result.exitCode === 0) {
          resolve({
            tool_use_id: '',
            content: output || '(no output)',
            is_error: false,
          });
          return;
        }

        resolve({
          tool_use_id: '',
          content: `Command exited with code ${result.exitCode ?? 'unknown'}:\n${output}`.trim(),
          is_error: true,
        });
      });
    });
  }
}

function clampTimeout(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const ms = Math.floor(value);
  if (ms < MIN_TIMEOUT) return MIN_TIMEOUT;
  if (ms > MAX_TIMEOUT) return MAX_TIMEOUT;
  return ms;
}
