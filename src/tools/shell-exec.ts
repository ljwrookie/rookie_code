import { spawn } from 'node:child_process';
import type { Tool } from './base.js';
import type { ToolDefinition, ToolResult } from '../types.js';
import { Sandbox } from '../security/sandbox.js';
import { confirm } from '../cli/confirm.js';
import { truncateByBytes } from '../utils/truncate.js';
import { DEFAULT_CONFIG } from '../config/defaults.js';

const DEFAULT_TIMEOUT = 120_000; // 120 seconds
const MAX_OUTPUT_BYTES = 100 * 1024; // 100KB

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

  private sandbox: Sandbox;

  constructor(
    private workingDir: string,
    private requireConfirmation: boolean = true,
  ) {
    this.sandbox = new Sandbox(DEFAULT_CONFIG.security);
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const command = input['command'] as string;
    const timeout = (input['timeout'] as number) ?? DEFAULT_TIMEOUT;

    try {
      // Security check
      const check = this.sandbox.checkCommand(command);

      if (check === 'blocked') {
        return {
          tool_use_id: '',
          content: `Command blocked for security reasons: ${command}\nThis command matches a dangerous pattern and cannot be executed.`,
          is_error: true,
        };
      }

      if (check === 'needs_confirmation' && this.requireConfirmation) {
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
      const result = await this.runCommand(command, timeout);
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
  ): Promise<ToolResult> {
    return new Promise((resolve) => {
      const env = this.sandbox.getSanitizedEnv();

      const child = spawn(command, {
        shell: true,
        cwd: this.workingDir,
        env,
        timeout,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        let output = stdout;
        if (stderr) {
          output += (output ? '\n' : '') + `STDERR:\n${stderr}`;
        }

        // Truncate large output
        output = truncateByBytes(output, MAX_OUTPUT_BYTES);

        if (code === 0) {
          resolve({
            tool_use_id: '',
            content: output || '(no output)',
            is_error: false,
          });
        } else {
          resolve({
            tool_use_id: '',
            content: `Command exited with code ${code}:\n${output}`,
            is_error: true,
          });
        }
      });

      child.on('error', (err) => {
        resolve({
          tool_use_id: '',
          content: `Failed to execute command: ${err.message}`,
          is_error: true,
        });
      });
    });
  }
}
