import fs from 'node:fs/promises';
import path from 'node:path';
import type { Tool } from './base.js';
import type { ToolDefinition, ToolResult } from '../types.js';
import { resolvePathForRead, resolvePathForWrite } from '../security/path-utils.js';
import { formatDiff } from '../editor/diff-display.js';
import { confirm } from '../cli/confirm.js';
import { assessTextChangeRisk } from '../changes/risk.js';
import { withUiPaused } from '../cli/active-ui.js';

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

  constructor(
    private workingDir: string,
    private options: {
      confirmHighRiskEdits: boolean;
      maxAutoEditLines: number;
    },
  ) {}

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const filePath = input['path'] as string;
    const content = input['content'] as string;

    try {
      const resolved = await resolvePathForWrite(this.workingDir, filePath);

      // Check if file already exists
      try {
        // If it exists, also ensure it resolves within working dir (symlink-safe).
        await resolvePathForRead(this.workingDir, filePath);
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

      if (this.options.confirmHighRiskEdits) {
        const diff = formatDiff('', content, { filePath, contextLines: 3 });
        const risk = assessTextChangeRisk({
          filePath,
          oldContent: '',
          newContent: content,
          maxAutoEditLines: this.options.maxAutoEditLines,
        });
        if (risk.needsConfirmation) {
          if (!process.stdin.isTTY) {
            return {
              tool_use_id: '',
              content:
                `High-risk file create detected for ${filePath}, but confirmation requires an interactive TTY.\n` +
                `Reasons: ${risk.reasons.join(', ')}\n\n` +
                stripAnsi(diff),
              is_error: true,
            };
          }
          const approved = await withUiPaused(async () => {
            console.error(diff);
            return confirm(`Create high-risk file ${filePath}? (${risk.reasons.join(', ')})`);
          });
          if (!approved) {
            return {
              tool_use_id: '',
              content: `User rejected high-risk file create for ${filePath}.`,
              is_error: true,
            };
          }
        }
      }

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
}

function stripAnsi(str: string): string {
  return str.replace(
    // eslint-disable-next-line no-control-regex
    /\u001b\[[0-9;]*m/g,
    '',
  );
}
