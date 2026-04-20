import fs from 'node:fs/promises';
import type { Tool } from './base.js';
import type { ToolDefinition, ToolResult } from '../types.js';
import { searchReplace } from '../editor/search-replace.js';
import { formatDiff } from '../editor/diff-display.js';
import { resolvePathForRead } from '../security/path-utils.js';
import { confirm } from '../cli/confirm.js';
import { assessTextChangeRisk } from '../changes/risk.js';
import { withUiPaused } from '../cli/active-ui.js';

export class EditFileTool implements Tool {
  definition: ToolDefinition = {
    name: 'edit_file',
    description:
      'Edit an existing file by replacing a specific string with a new string. ' +
      'The old_string should match uniquely in the file. Supports fuzzy matching ' +
      'for minor whitespace/indentation differences. ' +
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
            'Include enough context for a unique match. Must be non-empty for edit_file.',
        },
        new_string: {
          type: 'string',
          description: 'The replacement string.',
        },
      },
      required: ['path', 'old_string', 'new_string'],
    },
  };

  constructor(
    private workingDir: string,
    private options: {
      confirmFuzzyEdits: boolean;
      confirmHighRiskEdits: boolean;
      maxAutoEditLines: number;
    },
  ) {}

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const filePath = input['path'] as string;
    const oldString = input['old_string'] as string;
    const newString = input['new_string'] as string;

    try {
      // old_string must be non-empty for edits.
      if (!oldString) {
        return {
          tool_use_id: '',
          content:
            'Error: old_string must be non-empty for edit_file. ' +
            'Use write_file to create a new file.',
          is_error: true,
        };
      }

      // Case: Edit existing file using search-replace engine
      const resolved = await resolvePathForRead(this.workingDir, filePath);
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

      // Generate diff for display
      const diff = formatDiff(content, result.newContent!, {
        filePath,
        contextLines: 3,
      });

      // If fuzzy match was used, require confirmation (safe default).
      if (result.usedFuzzyMatch && this.options.confirmFuzzyEdits) {
        if (!process.stdin.isTTY) {
          return {
            tool_use_id: '',
            content:
              `Fuzzy match detected for ${filePath}, but confirmation requires an interactive TTY.\n` +
              `Re-run in an interactive session or disable confirmation.\n\n` +
              stripAnsi(diff),
            is_error: true,
          };
        }

        const approved = await withUiPaused(async () => {
          console.error(diff);
          return confirm(`Apply fuzzy edit to ${filePath}?`);
        });
        if (!approved) {
          return {
            tool_use_id: '',
            content: `User rejected fuzzy edit for ${filePath}.`,
            is_error: true,
          };
        }
      }

      // High-risk changes also require confirmation.
      if (this.options.confirmHighRiskEdits) {
        const risk = assessTextChangeRisk({
          filePath,
          oldContent: content,
          newContent: result.newContent!,
          maxAutoEditLines: this.options.maxAutoEditLines,
        });
        if (risk.needsConfirmation) {
          if (!process.stdin.isTTY) {
            return {
              tool_use_id: '',
              content:
                `High-risk edit detected for ${filePath}, but confirmation requires an interactive TTY.\n` +
                `Reasons: ${risk.reasons.join(', ')}\n\n` +
                stripAnsi(diff),
              is_error: true,
            };
          }
          const approved = await withUiPaused(async () => {
            console.error(diff);
            return confirm(`Apply high-risk edit to ${filePath}? (${risk.reasons.join(', ')})`);
          });
          if (!approved) {
            return {
              tool_use_id: '',
              content: `User rejected high-risk edit for ${filePath}.`,
              is_error: true,
            };
          }
        }
      }

      // Success — write the new content
      await fs.writeFile(resolved, result.newContent!, 'utf-8');

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
}

/**
 * Strip ANSI escape codes from a string.
 */
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\u001b\[\d+(;\d+)*m/g, '');
}
