import { spawn } from 'node:child_process';
import type { Tool } from './base.js';
import type { ToolDefinition, ToolResult } from '../types.js';
import { truncateByLines } from '../utils/truncate.js';

const MAX_RESULTS = 50;

export class SearchCodeTool implements Tool {
  definition: ToolDefinition = {
    name: 'search_code',
    description:
      'Search for a pattern in code files using ripgrep (rg). ' +
      'Returns matching lines with file paths and line numbers. ' +
      'Respects .gitignore. Falls back to grep if rg is not available.',
    input_schema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Search pattern (regex supported)',
        },
        path: {
          type: 'string',
          description: 'Directory or file to search in. Defaults to working directory.',
        },
        include: {
          type: 'string',
          description: 'Glob pattern to filter files (e.g., "*.ts", "*.py")',
        },
        max_results: {
          type: 'number',
          description: `Maximum number of results. Defaults to ${MAX_RESULTS}.`,
        },
      },
      required: ['pattern'],
    },
  };

  constructor(private workingDir: string) {}

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const pattern = input['pattern'] as string;
    const searchPath = (input['path'] as string) ?? '.';
    const include = input['include'] as string | undefined;
    const maxResults = (input['max_results'] as number) ?? MAX_RESULTS;

    try {
      // Try ripgrep first, then fallback to grep
      const result = await this.tryRipgrep(pattern, searchPath, include, maxResults)
        .catch(() => this.tryGrep(pattern, searchPath, include, maxResults));

      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        tool_use_id: '',
        content: `Search failed: ${msg}`,
        is_error: true,
      };
    }
  }

  private tryRipgrep(
    pattern: string,
    searchPath: string,
    include: string | undefined,
    maxResults: number,
  ): Promise<ToolResult> {
    const args = [
      '--line-number',
      '--color=never',
      '--max-count', String(maxResults),
      '--no-heading',
    ];

    if (include) {
      args.push('--glob', include);
    }

    args.push(pattern, searchPath);

    return this.runSearch('rg', args);
  }

  private tryGrep(
    pattern: string,
    searchPath: string,
    include: string | undefined,
    maxResults: number,
  ): Promise<ToolResult> {
    const args = [
      '-rn',
      '--color=never',
    ];

    if (include) {
      args.push('--include', include);
    }

    args.push(pattern, searchPath);
    // Limit results via head
    args.push('-m', String(maxResults));

    return this.runSearch('grep', args);
  }

  private runSearch(cmd: string, args: string[]): Promise<ToolResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(cmd, args, {
        cwd: this.workingDir,
        timeout: 30_000,
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
        if (code === 1 && !stderr) {
          // grep returns 1 for no matches
          resolve({
            tool_use_id: '',
            content: 'No matches found.',
            is_error: false,
          });
          return;
        }

        if (code !== 0 && code !== 1) {
          reject(new Error(`${cmd} exited with code ${code}: ${stderr}`));
          return;
        }

        const output = truncateByLines(stdout.trimEnd(), 100);
        const lines = output.split('\n').length;
        resolve({
          tool_use_id: '',
          content: `Found ${lines} matching lines:\n\n${output}`,
          is_error: false,
        });
      });

      child.on('error', () => {
        reject(new Error(`${cmd} not found`));
      });
    });
  }
}
