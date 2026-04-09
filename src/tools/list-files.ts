import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Tool } from './base.js';
import type { ToolDefinition, ToolResult } from '../types.js';

const MAX_ENTRIES = 500;

export class ListFilesTool implements Tool {
  definition: ToolDefinition = {
    name: 'list_files',
    description:
      'List files and directories. In a git repo, uses git ls-files to respect .gitignore. ' +
      'Otherwise falls back to filesystem listing. Returns file paths with sizes.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Directory to list. Defaults to working directory.',
        },
        recursive: {
          type: 'boolean',
          description: 'Whether to list recursively. Defaults to false.',
        },
        pattern: {
          type: 'string',
          description: 'Glob pattern to filter files (e.g., "*.ts")',
        },
      },
    },
  };

  constructor(private workingDir: string) {}

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const listPath = (input['path'] as string) ?? '.';
    const recursive = (input['recursive'] as boolean) ?? false;
    const pattern = input['pattern'] as string | undefined;

    try {
      const resolvedPath = path.resolve(this.workingDir, listPath);

      // Try git ls-files first (respects .gitignore)
      const gitResult = await this.tryGitLsFiles(resolvedPath, recursive, pattern).catch(
        () => null,
      );
      if (gitResult) return gitResult;

      // Fallback to fs listing
      return await this.fsListing(resolvedPath, recursive, pattern);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        tool_use_id: '',
        content: `Error listing files: ${msg}`,
        is_error: true,
      };
    }
  }

  private tryGitLsFiles(
    dirPath: string,
    recursive: boolean,
    pattern: string | undefined,
  ): Promise<ToolResult> {
    return new Promise((resolve, reject) => {
      const args = ['ls-files', '--cached', '--others', '--exclude-standard'];
      if (!recursive) {
        // Only top-level files in the given directory
      }

      const child = spawn('git', args, {
        cwd: dirPath,
        timeout: 10_000,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      child.on('close', (code) => {
        if (code !== 0) {
          reject(new Error('Not a git repository'));
          return;
        }

        let files = stdout.trim().split('\n').filter(Boolean);

        // Filter by pattern
        if (pattern) {
          const regex = this.globToRegex(pattern);
          files = files.filter((f) => regex.test(f));
        }

        // Filter by non-recursive (only direct children)
        if (!recursive) {
          const rel = path.relative(this.workingDir, dirPath) || '.';
          files = files.filter((f) => {
            const dir = path.dirname(f);
            return dir === '.' || dir === rel;
          });
        }

        // Truncate
        const total = files.length;
        if (files.length > MAX_ENTRIES) {
          files = files.slice(0, MAX_ENTRIES);
        }

        const output = files.join('\n');
        const truncNote =
          total > MAX_ENTRIES
            ? `\n\n[Showing ${MAX_ENTRIES} of ${total} files]`
            : '';

        resolve({
          tool_use_id: '',
          content: `${total} files:\n\n${output}${truncNote}`,
          is_error: false,
        });
      });

      child.on('error', () => {
        reject(new Error('git not found'));
      });
    });
  }

  private async fsListing(
    dirPath: string,
    recursive: boolean,
    pattern: string | undefined,
  ): Promise<ToolResult> {
    const entries = await fs.readdir(dirPath, {
      withFileTypes: true,
      recursive,
    });

    let files = entries
      .filter((e) => e.isFile() || e.isDirectory())
      .map((e) => {
        const rel = e.parentPath
          ? path.relative(dirPath, path.join(e.parentPath, e.name))
          : e.name;
        return e.isDirectory() ? `${rel}/` : rel;
      });

    // Filter by pattern
    if (pattern) {
      const regex = this.globToRegex(pattern);
      files = files.filter((f) => regex.test(f));
    }

    // Truncate
    const total = files.length;
    if (files.length > MAX_ENTRIES) {
      files = files.slice(0, MAX_ENTRIES);
    }

    const output = files.join('\n');
    const truncNote =
      total > MAX_ENTRIES
        ? `\n\n[Showing ${MAX_ENTRIES} of ${total} files]`
        : '';

    return {
      tool_use_id: '',
      content: `${total} entries:\n\n${output}${truncNote}`,
      is_error: false,
    };
  }

  /** Convert simple glob to regex */
  private globToRegex(glob: string): RegExp {
    const escaped = glob
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    return new RegExp(escaped);
  }
}
