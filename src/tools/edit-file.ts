import fs from 'node:fs/promises';
import path from 'node:path';
import type { Tool } from './base.js';
import type { ToolDefinition, ToolResult } from '../types.js';
import { searchReplace } from '../editor/search-replace.js';
import { formatDiff } from '../editor/diff-display.js';

export class EditFileTool implements Tool {
  definition: ToolDefinition = {
    name: 'edit_file',
    description:
      'Edit a file by replacing a specific string with a new string. ' +
      'The old_string should match uniquely in the file. Supports fuzzy matching ' +
      'for minor whitespace/indentation differences. ' +
      'If old_string is empty and the file does not exist, creates the file with new_string. ' +
      'Returns a diff preview on success.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path (relative to working directory or absolute)',
        },
        old_string: {
          type: 'string',
          description:
            'The string to find and replace. Must match uniquely. ' +
            'Include enough context for a unique match. Empty string + non-existent file = create new file.',
        },
        new_string: {
          type: 'string',
          description: 'The replacement string.',
        },
      },
      required: ['path', 'old_string', 'new_string'],
    },
  };

  constructor(private workingDir: string) {}

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const filePath = input['path'] as string;
    const oldString = input['old_string'] as string;
    const newString = input['new_string'] as string;

    try {
      const resolved = this.resolvePath(filePath);

      // Case: Create new file (old_string is empty)
      if (!oldString) {
        const exists = await fileExists(resolved);
        if (exists) {
          return {
            tool_use_id: '',
            content:
              'Error: old_string is empty but file already exists. ' +
              'Use a non-empty old_string to edit existing files, or use write_file to overwrite.',
            is_error: true,
          };
        }
        await fs.mkdir(path.dirname(resolved), { recursive: true });
        await fs.writeFile(resolved, newString, 'utf-8');
        return {
          tool_use_id: '',
          content: `Created new file: ${filePath} (${newString.split('\n').length} lines)`,
          is_error: false,
        };
      }

      // Case: Edit existing file using search-replace engine
      const content = await fs.readFile(resolved, 'utf-8');
      const result = searchReplace({
        content,
        oldString,
        newString,
        fuzzyThreshold: 0.85,
      });

      if (!result.success) {
        // Build helpful error message
        if (result.matchCount > 1) {
          const positions = result.matchPositions
            ?.map(p => `line ${p.line}`)
            .join(', ') ?? 'unknown';
          return {
            tool_use_id: '',
            content:
              `Error: old_string found ${result.matchCount} times in ${filePath} (at ${positions}). ` +
              'Provide more context in old_string to make it unique.',
            is_error: true,
          };
        }

        // Zero matches
        const lines = content.split('\n');
        const preview =
          lines.length <= 20
            ? content
            : lines.slice(0, 10).join('\n') + '\n...\n' + lines.slice(-5).join('\n');
        return {
          tool_use_id: '',
          content:
            `Error: old_string not found in ${filePath}.\n` +
            `File has ${lines.length} lines. Preview:\n${preview}\n\n` +
            'Make sure old_string matches the file content exactly, including whitespace and indentation.',
          is_error: true,
        };
      }

      // Success — write the new content
      await fs.writeFile(resolved, result.newContent!, 'utf-8');

      // Generate diff for display
      const diff = formatDiff(content, result.newContent!, {
        filePath,
        contextLines: 3,
      });

      // Strip ANSI codes for the tool result (LLM doesn't need colors)
      const plainDiff = stripAnsi(diff);

      let message = `File edited: ${filePath}`;
      if (result.usedFuzzyMatch) {
        message += ` (fuzzy match, similarity: ${(result.fuzzySimilarity! * 100).toFixed(0)}%)`;
      }
      message += `\n\n${plainDiff}`;

      return {
        tool_use_id: '',
        content: message,
        is_error: false,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        tool_use_id: '',
        content: `Error editing file: ${msg}`,
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

// --- Helper functions ---

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Strip ANSI escape codes from a string.
 */
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\u001b\[\d+(;\d+)*m/g, '');
}
