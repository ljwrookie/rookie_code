import type { Tool } from './base.js';
import type { ToolDefinition, ToolResult } from '../types.js';
import { truncateByLines } from '../utils/truncate.js';
import { resolvePathForRead } from '../security/path-utils.js';
import { runProcess } from '../utils/process.js';
import type { ToolExecutionContext } from './base.js';

const MAX_RESULTS = 50;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 60_000;

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
        timeout_ms: {
          type: 'number',
          description: `Timeout in milliseconds. Defaults to ${DEFAULT_TIMEOUT_MS}. Max ${MAX_TIMEOUT_MS}.`,
        },
      },
      required: ['pattern'],
    },
  };

  constructor(private workingDir: string) {}

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    return this.executeWithContext(input, { depth: 0 });
  }

  async executeWithContext(input: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult> {
    const pattern = input['pattern'] as string;
    const searchPath = (input['path'] as string) ?? '.';
    const include = input['include'] as string | undefined;
    const maxResults = clampMaxResults(input['max_results'], MAX_RESULTS);
    const timeoutMs = clampTimeoutMs(input['timeout_ms'], DEFAULT_TIMEOUT_MS);

    try {
      const resolvedSearchPath = searchPath === '.'
        ? this.workingDir
        : await resolvePathForRead(this.workingDir, searchPath);

      // Try ripgrep first, then fallback to grep
      const result = await this.tryRipgrep(pattern, resolvedSearchPath, include, maxResults, timeoutMs, ctx.signal)
        .catch(() => this.tryGrep(pattern, resolvedSearchPath, include, maxResults, timeoutMs, ctx.signal));

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
    timeoutMs: number,
    signal?: AbortSignal,
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

    return this.runSearch('rg', args, timeoutMs, signal);
  }

  private tryGrep(
    pattern: string,
    searchPath: string,
    include: string | undefined,
    maxResults: number,
    timeoutMs: number,
    signal?: AbortSignal,
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

    return this.runSearch('grep', args, timeoutMs, signal);
  }

  private runSearch(cmd: string, args: string[], timeoutMs: number, signal?: AbortSignal): Promise<ToolResult> {
    return new Promise((resolve, reject) => {
      runProcess({
        command: cmd,
        args,
        cwd: this.workingDir,
        timeoutMs,
        signal,
      }).then(({ stdout, stderr, exitCode, timedOut, aborted }) => {
        if (aborted) {
          reject(new Error(`${cmd} aborted`));
          return;
        }
        if (timedOut) {
          reject(new Error(`${cmd} timed out after ${timeoutMs}ms`));
          return;
        }
        const code = exitCode;
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
    });
  }
}

function clampMaxResults(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const n = Math.floor(value);
  if (n <= 0) return 1;
  return Math.min(n, MAX_RESULTS);
}

function clampTimeoutMs(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const ms = Math.floor(value);
  if (ms < 1_000) return 1_000;
  return Math.min(ms, MAX_TIMEOUT_MS);
}
