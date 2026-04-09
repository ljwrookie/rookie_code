import fs from 'node:fs/promises';
import path from 'node:path';
import type { Tool } from './base.js';
import type { ToolDefinition, ToolResult } from '../types.js';

export class WriteFileTool implements Tool {
  definition: ToolDefinition = {
    name: 'write_file',
    description:
      'Create a new file with the given content. ' +
      'If the file already exists, returns an error — use edit_file to modify existing files. ' +
      'Creates parent directories if they do not exist.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path (relative to working directory or absolute)',
        },
        content: {
          type: 'string',
          description: 'The content to write to the file',
        },
      },
      required: ['path', 'content'],
    },
  };

  constructor(private workingDir: string) {}

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const filePath = input['path'] as string;
    const content = input['content'] as string;

    try {
      const resolved = this.resolvePath(filePath);

      // Check if file already exists
      try {
        await fs.access(resolved);
        return {
          tool_use_id: '',
          content:
            `Error: File "${filePath}" already exists. ` +
            'Use edit_file to modify existing files.',
          is_error: true,
        };
      } catch {
        // File doesn't exist — good, we can create it
      }

      // Create parent directories
      await fs.mkdir(path.dirname(resolved), { recursive: true });

      // Write file
      await fs.writeFile(resolved, content, 'utf-8');

      const lineCount = content.split('\n').length;
      return {
        tool_use_id: '',
        content: `Created file: ${filePath} (${lineCount} lines)`,
        is_error: false,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        tool_use_id: '',
        content: `Error writing file: ${msg}`,
        is_error: true,
      };
    }
  }

  private resolvePath(filePath: string): string {
    const resolved = path.resolve(this.workingDir, filePath);
    if (!resolved.startsWith(this.workingDir)) {
      throw new Error(
        `Path "${filePath}" resolves outside the working directory. Access denied.`,
      );
    }
    return resolved;
  }
}
