import fs from 'node:fs/promises';
import path from 'node:path';
import type { Tool } from './base.js';
import type { ToolDefinition, ToolResult } from '../types.js';
import { addLineNumbers, truncateByLines } from '../utils/truncate.js';

const MAX_LINES = 2000;

/**
 * Detect if a buffer is likely binary content.
 */
function isBinary(buffer: Buffer): boolean {
  // Check first 8KB for null bytes (common binary indicator)
  const sample = buffer.subarray(0, 8192);
  for (let i = 0; i < sample.length; i++) {
    if (sample[i] === 0) return true;
  }
  return false;
}

export class ReadFileTool implements Tool {
  definition: ToolDefinition = {
    name: 'read_file',
    description:
      'Read the contents of a file. Returns the file content with line numbers. ' +
      'Use offset and limit for large files. Binary files return a size description.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path (relative to working directory or absolute)',
        },
        offset: {
          type: 'number',
          description: 'Starting line number (1-based). Defaults to 1.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of lines to return. Defaults to 2000.',
        },
      },
      required: ['path'],
    },
  };

  constructor(private workingDir: string) {}

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const filePath = input['path'] as string;
    const offset = (input['offset'] as number) ?? 1;
    const limit = (input['limit'] as number) ?? MAX_LINES;

    try {
      const resolved = this.resolvePath(filePath);
      const buffer = await fs.readFile(resolved);

      if (isBinary(buffer)) {
        return {
          tool_use_id: '',
          content: `(binary file, ${buffer.length} bytes)`,
          is_error: false,
        };
      }

      const fullText = buffer.toString('utf-8');
      const lines = fullText.split('\n');
      const totalLines = lines.length;

      // Apply offset and limit
      const startIdx = Math.max(0, offset - 1);
      const endIdx = Math.min(totalLines, startIdx + limit);
      const selectedLines = lines.slice(startIdx, endIdx);
      let content = addLineNumbers(selectedLines.join('\n'), offset);

      // If truncated, add a note
      if (endIdx < totalLines) {
        content += `\n\n[Showing lines ${offset}-${endIdx} of ${totalLines}. Use offset/limit to see more.]`;
      }

      // Safety truncation for very long lines
      content = truncateByLines(content, MAX_LINES + 10);

      return { tool_use_id: '', content, is_error: false };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { tool_use_id: '', content: `Error reading file: ${msg}`, is_error: true };
    }
  }

  private resolvePath(filePath: string): string {
    const resolved = path.resolve(this.workingDir, filePath);

    // Security: prevent path traversal outside working directory
    if (!resolved.startsWith(this.workingDir)) {
      throw new Error(
        `Path "${filePath}" resolves outside the working directory. Access denied.`,
      );
    }

    return resolved;
  }
}
